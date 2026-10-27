package com.rnboilerplate.screenocr.share

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.rnboilerplate.R
import java.io.IOException
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import org.json.JSONException
import org.json.JSONObject

/**
 * Shares the app's spoken audio with one paired Chrome extension on the same
 * Wi-Fi (see [ShareProtocol]). Process-wide: alive while sharing is switched
 * on and the app process runs (the floating-button service keeps it alive in
 * the background).
 *
 * Policy: one receiver at a time; others get "busy". Pairing needs only the
 * phone's address, so every new receiver must be allowed by the user on the
 * phone (after matching the 6-digit fingerprint); after a deny or timeout,
 * new requests are refused for [PAIR_COOLDOWN_MS] so they can't be spammed.
 * A paired receiver gets a resume key so it can reconnect after a network
 * drop without asking again; the key dies when sharing stops or either side
 * disconnects. Audio is only sent while the receiver is listening.
 *
 * Nothing about keys or audio is logged.
 */
@SuppressLint("StaticFieldLeak") // Holds the application context only.
object AudioShareHub {
  enum class State { OFF, WAITING, PENDING, CONNECTED, STREAMING }

  private const val TAG = "AudioShare"
  const val PORT = 47811
  private const val PAIR_COOLDOWN_MS = 5_000L
  private const val APPROVAL_TIMEOUT_MS = 60_000L
  private const val HANDSHAKE_TIMEOUT_MS = 10_000
  private const val IDLE_TIMEOUT_MS = 45_000
  private const val PING_INTERVAL_S = 15L
  private const val CHUNK_MS = 100
  /** How far ahead of real time audio may be sent (fills the receiver's buffer). */
  private const val LEAD_MS = 300L
  private const val NOTIFICATION_ID = 4711
  private const val CHANNEL_ID = "audio_share"

  private val main = Handler(Looper.getMainLooper())
  private val lock = Any()
  private var context: Context? = null
  private var server: ServerSocket? = null
  private var acceptThread: Thread? = null
  private var audio: ScheduledExecutorService? = null
  private var client: Client? = null
  private var pairBlockedUntil = 0L
  private var resumeKey: ByteArray? = null
  private var error: String? = null
  @Volatile private var audioGeneration = 0
  @Volatile private var lastAudioAt = 0L

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /** Starts or stops sharing to match the user's switch. Idempotent. */
  fun apply(appContext: Context, enabled: Boolean) {
    if (enabled) start(appContext) else stop()
  }

  private fun start(appContext: Context) {
    synchronized(lock) {
      if (server != null) return
      context = appContext.applicationContext
      error = null
      val socket =
        try {
          openServer()
        } catch (e: IOException) {
          Log.w(TAG, "Could not listen: ${e.javaClass.simpleName}")
          error = "port_failed"
          return
        }
      server = socket
      audio = Executors.newSingleThreadScheduledExecutor()
      audio?.scheduleWithFixedDelay({ ping() }, PING_INTERVAL_S, PING_INTERVAL_S, TimeUnit.SECONDS)
      acceptThread = Thread({ acceptLoop(socket) }, "audio-share-accept").also { it.start() }
    }
  }

  private fun openServer(): ServerSocket =
    try {
      ServerSocket().apply {
        reuseAddress = true
        bind(InetSocketAddress(PORT))
      }
    } catch (_: IOException) {
      // The usual port is taken: any free one (shown to the user anyway).
      ServerSocket(0)
    }

  fun stop() {
    val old: Client?
    synchronized(lock) {
      old = client
      client = null
      resumeKey = null
      try {
        server?.close()
      } catch (_: IOException) {
      }
      server = null
      acceptThread = null
      audio?.shutdownNow()
      audio = null
      error = null
    }
    old?.close("sharing_stopped")
    main.post { cancelApprovalNotification() }
  }

  // ── State for the app's card ──────────────────────────────────────────

  fun statusJson(): JSONObject =
    synchronized(lock) {
      val c = client
      val state =
        when {
          server == null -> State.OFF
          c == null || !c.authenticated && !c.awaitingApproval -> State.WAITING
          c.awaitingApproval -> State.PENDING
          c.listening -> State.STREAMING
          else -> State.CONNECTED
        }
      JSONObject()
        .put("state", state.name.lowercase())
        .put("address", if (server != null) localAddress().orEmpty() else "")
        .put("port", server?.localPort ?: 0)
        .put("receiverName", c?.name.orEmpty())
        .put("fingerprint", c?.fingerprint.orEmpty())
        .put("transmitting", System.currentTimeMillis() - lastAudioAt < 1500)
        .put("error", error ?: if (server != null && localAddress() == null) "no_wifi" else "")
    }

  fun respond(approve: Boolean) {
    synchronized(lock) { client }?.decide(approve)
    main.post { cancelApprovalNotification() }
  }

  /** Ends the receiver's session and forgets its resume key. */
  fun disconnect() {
    val old: Client?
    synchronized(lock) {
      old = client
      client = null
      resumeKey = null
    }
    old?.close("disconnected_by_phone")
    flush()
  }


  /** The phone's IPv4 address on Wi-Fi (or its own hotspot). */
  private fun localAddress(): String? =
    try {
      NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
        .filter { it.isUp && !it.isLoopback }
        .sortedBy { if (it.name.startsWith("wlan")) 0 else 1 }
        .flatMap { it.inetAddresses.toList() }
        .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }
        ?.hostAddress
    } catch (_: Exception) {
      null
    }

  // ── Audio (from SharedSpeech) ─────────────────────────────────────────

  /** A paired receiver is listening: speech should go through SharedSpeech. */
  val isStreaming: Boolean
    get() = synchronized(lock) { client?.let { it.authenticated && it.listening } == true }

  /** Drops audio queued for the receiver (new request, stop, skip). */
  fun flush() {
    audioGeneration++
    // Never write to the socket on the main thread (NetworkOnMainThreadException).
    val executor = synchronized(lock) { audio } ?: return
    executor.execute { synchronized(lock) { client }?.sendJson(JSONObject().put("t", "flush")) }
  }

  /** Sends [clip] to the receiver, paced to real time. */
  fun sendClip(clip: PcmClip) {
    val executor = synchronized(lock) { audio } ?: return
    val generation = audioGeneration
    executor.execute {
      val chunk = (clip.bytesPerSecond * CHUNK_MS / 1000) and 0x7ffffffe
      val started = System.currentTimeMillis()
      var offset = 0
      while (offset < clip.data.size) {
        if (generation != audioGeneration) return@execute
        val c = synchronized(lock) { client }?.takeIf { it.authenticated && it.listening } ?: return@execute
        val length = minOf(chunk, clip.data.size - offset)
        c.sendPayload(ShareProtocol.pcmPayload(clip.sampleRate, clip.channels, clip.data, offset, length))
        lastAudioAt = System.currentTimeMillis()
        offset += length
        // Pace to real time (plus a small lead) so the receiver's buffer stays shallow.
        val audioMs = offset * 1000L / clip.bytesPerSecond
        val wait = started + audioMs - LEAD_MS - System.currentTimeMillis()
        if (wait > 0) Thread.sleep(wait)
      }
    }
  }

  private fun ping() {
    synchronized(lock) { client }?.takeIf { it.authenticated }?.sendJson(JSONObject().put("t", "ping"))
  }

  // ── Connections ───────────────────────────────────────────────────────

  private fun acceptLoop(socket: ServerSocket) {
    while (!socket.isClosed) {
      val s =
        try {
          socket.accept()
        } catch (_: IOException) {
          return
        }
      Thread({ Client(s).run() }, "audio-share-client").start()
    }
  }

  private class Rejected(val reason: String) : Exception(reason)

  private class Client(private val socket: Socket) {
    @Volatile var authenticated = false
    @Volatile var awaitingApproval = false
    @Volatile var listening = false
    @Volatile var name = ""
    @Volatile var fingerprint = ""
    private var ws: WebSocketConnection? = null
    private var sealer: ShareProtocol.Sealer? = null
    private var decision: Boolean? = null
    private val decided = CountDownLatch(1)

    fun run() {
      try {
        socket.soTimeout = HANDSHAKE_TIMEOUT_MS
        socket.tcpNoDelay = true
        val input = socket.getInputStream()
        val output = socket.getOutputStream()
        val (line, headers) = WebSocketConnection.readRequest(input) ?: return
        WebSocketConnection.rejectReason(line, headers)?.let { reason ->
          output.write("HTTP/1.1 $reason\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
          return
        }
        output.write(WebSocketConnection.upgradeResponse(headers.getValue("sec-websocket-key")).toByteArray())
        val conn = WebSocketConnection(input, output).also { ws = it }
        try {
          handshake(conn)
        } catch (e: Rejected) {
          conn.sendText(JSONObject().put("t", "error").put("code", e.reason).toString())
          conn.sendClose(4000)
          return
        }
        socket.soTimeout = IDLE_TIMEOUT_MS
        readLoop(conn)
      } catch (_: SocketTimeoutException) {
        // Silent peer: treat as gone.
      } catch (_: IOException) {
        // Network dropped or the peer closed.
      } catch (_: JSONException) {
      } finally {
        close(null)
        detach()
      }
    }

    private fun handshake(conn: WebSocketConnection) {
      val hello = readJson(conn)
      if (hello.optString("t") != "hello" || hello.optInt("v") != ShareProtocol.VERSION) throw Rejected("bad_version")
      val mode = hello.optString("mode")
      val clientPub = B64.decode(hello.optString("pub"))?.takeIf { it.size == 65 } ?: throw Rejected("bad_request")
      val clientNonce = B64.decode(hello.optString("nonce"))?.takeIf { it.size == 16 } ?: throw Rejected("bad_request")
      name = hello.optString("name").take(40).filter { !it.isISOControl() }.ifBlank { "Chrome" }

      val secret: ByteArray =
        synchronized(lock) {
          if (client?.authenticated == true || client?.awaitingApproval == true) throw Rejected("busy")
          when (mode) {
            "pair" -> {
              if (System.currentTimeMillis() < pairBlockedUntil) throw Rejected("denied")
              ShareProtocol.PAIR_SECRET
            }
            "resume" -> resumeKey ?: throw Rejected("resume_invalid")
            else -> throw Rejected("bad_request")
          }
        }

      val pair = ShareProtocol.newKeyPair()
      val serverPub = ShareProtocol.rawPublicKey(pair)
      val serverNonce = ShareProtocol.randomBytes(16)
      conn.sendText(
        JSONObject().put("t", "challenge").put("pub", B64.encode(serverPub)).put("nonce", B64.encode(serverNonce)).toString(),
      )
      val keys =
        ShareProtocol.deriveKeys(
          ShareProtocol.sharedSecret(pair, clientPub),
          secret,
          clientPub,
          serverPub,
          clientNonce,
          serverNonce,
        )
      val confirm = readJson(conn)
      val mac = B64.decode(confirm.optString("mac")) ?: ByteArray(0)
      if (confirm.optString("t") != "confirm" || !ShareProtocol.constantTimeEquals(mac, keys.clientMac())) {
        throw Rejected(if (mode == "pair") "bad_request" else "resume_invalid")
      }
      fingerprint = keys.fingerprint()

      if (mode == "pair") {
        synchronized(lock) {
          if (client?.authenticated == true || client?.awaitingApproval == true) throw Rejected("busy")
          client = this
          awaitingApproval = true
        }
        conn.sendText(
          JSONObject().put("t", "pending").put("mac", B64.encode(keys.serverMac())).put("fingerprint", fingerprint).toString(),
        )
        main.post { showApprovalNotification(name, fingerprint) }
        socket.soTimeout = (APPROVAL_TIMEOUT_MS + 5_000).toInt()
        val approved = decided.await(APPROVAL_TIMEOUT_MS, TimeUnit.MILLISECONDS) && decision == true
        awaitingApproval = false
        main.post { cancelApprovalNotification() }
        if (!approved) {
          synchronized(lock) { pairBlockedUntil = System.currentTimeMillis() + PAIR_COOLDOWN_MS }
          throw Rejected("denied")
        }
        synchronized(lock) { resumeKey = ShareProtocol.randomBytes(32) }
      } else {
        // Proof of the resume key: this is the same receiver coming back, so
        // it replaces a connection the phone hasn't noticed is dead yet.
        val stale =
          synchronized(lock) {
            if (client?.awaitingApproval == true) throw Rejected("busy")
            client.also { client = this }
          }
        stale?.close(null)
        conn.sendText(
          JSONObject().put("t", "ready").put("mac", B64.encode(keys.serverMac())).put("fingerprint", fingerprint).toString(),
        )
      }

      opener = ShareProtocol.Opener(keys.clientToServer, ShareProtocol.DIR_CLIENT_TO_SERVER)
      sealer = ShareProtocol.Sealer(keys.serverToClient, ShareProtocol.DIR_SERVER_TO_CLIENT)
      authenticated = true
      val key = synchronized(lock) { resumeKey } ?: throw Rejected("resume_invalid")
      sendJson(
        JSONObject()
          .put("t", "welcome")
          .put("resumeKey", B64.encode(key))
          .put("device", "Akshar · ${Build.MODEL}".take(60)),
      )
    }

    private var opener: ShareProtocol.Opener? = null

    private fun readLoop(conn: WebSocketConnection) {
      while (true) {
        val message = conn.read() ?: return
        val bytes = (message as? WebSocketConnection.Message.Binary)?.bytes ?: continue
        val plain = opener?.open(bytes) ?: return // Forged or replayed: drop the connection.
        if (plain.isEmpty() || plain[0] != ShareProtocol.TYPE_JSON) continue
        val json = JSONObject(String(plain, 1, plain.size - 1, Charsets.UTF_8))
        when (json.optString("t")) {
          "listen" -> {
            listening = json.optBoolean("on")
            if (!listening) audioGeneration++
          }
          "bye" -> {
            synchronized(lock) { if (client === this) resumeKey = null }
            return
          }
          // "pong" and anything else just keep the connection alive.
        }
      }
    }

    private fun readJson(conn: WebSocketConnection): JSONObject {
      val message = conn.read() as? WebSocketConnection.Message.Text ?: throw IOException("Closed")
      return JSONObject(message.text)
    }

    fun decide(approve: Boolean) {
      decision = approve
      decided.countDown()
    }

    fun sendJson(json: JSONObject) {
      if (authenticated) sendPayload(ShareProtocol.jsonPayload(json.toString()))
    }

    fun sendPayload(payload: ByteArray) {
      if (Looper.myLooper() == Looper.getMainLooper()) {
        // Socket writes are forbidden on the main thread; keep order via the audio thread.
        synchronized(lock) { audio }?.execute { sendPayload(payload) }
        return
      }
      val s = sealer ?: return
      try {
        ws?.sendBinary(s.seal(payload))
      } catch (_: IOException) {
        close(null)
      }
    }

    /** Says why (if given) and closes; the read loop then detaches. */
    fun close(reason: String?) {
      decided.countDown()
      val finish = {
        if (reason != null) sendJson(JSONObject().put("t", "bye").put("reason", reason))
        try {
          ws?.sendClose()
          socket.close()
        } catch (_: IOException) {
        }
      }
      if (Looper.myLooper() == Looper.getMainLooper()) Thread(finish, "audio-share-close").start() else finish()
    }

    private fun detach() {
      val wasCurrent =
        synchronized(lock) {
          if (client === this) {
            client = null
            true
          } else {
            false
          }
        }
      if (wasCurrent) {
        audioGeneration++
        main.post { cancelApprovalNotification() }
      }
    }
  }

  // ── Approval notification ─────────────────────────────────────────────

  private fun showApprovalNotification(receiver: String, fingerprint: String) {
    val ctx = context ?: return
    val manager = ctx.getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager?.getNotificationChannel(CHANNEL_ID) == null) {
      manager?.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, ctx.getString(R.string.audio_share_channel), NotificationManager.IMPORTANCE_HIGH),
      )
    }
    fun action(approve: Boolean) =
      PendingIntent.getBroadcast(
        ctx,
        if (approve) 1 else 2,
        Intent(ctx, AudioShareActionReceiver::class.java).putExtra(AudioShareActionReceiver.EXTRA_APPROVE, approve),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    val notification =
      NotificationCompat.Builder(ctx, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_scan_text)
        .setContentTitle(ctx.getString(R.string.audio_share_request_title, receiver))
        .setContentText(ctx.getString(R.string.audio_share_request_body, fingerprint))
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setAutoCancel(true)
        .setTimeoutAfter(APPROVAL_TIMEOUT_MS)
        .addAction(0, ctx.getString(R.string.audio_share_deny), action(false))
        .addAction(0, ctx.getString(R.string.audio_share_allow), action(true))
        .build()
    try {
      NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
      // Notifications are off: the request still shows in the app's card.
    }
  }

  private fun cancelApprovalNotification() {
    context?.let { NotificationManagerCompat.from(it).cancel(NOTIFICATION_ID) }
  }
}

/** Allow / Deny on the connection-request notification. */
class AudioShareActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    AudioShareHub.respond(intent.getBooleanExtra(EXTRA_APPROVE, false))
  }

  companion object {
    const val EXTRA_APPROVE = "approve"
  }
}
