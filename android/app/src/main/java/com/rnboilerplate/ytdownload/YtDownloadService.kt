package com.rnboilerplate.ytdownload

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.rnboilerplate.R
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.UUID

/** Everything the service needs to run one download (passed as JSON in the start intent). */
data class DownloadJob(
  val id: String,
  val title: String,
  val author: String,
  val durationSec: Long,
  val option: DownloadOption,
) {
  fun toJson(): JSONObject =
    JSONObject().apply {
      put("id", id)
      put("title", title)
      put("author", author)
      put("durationSec", durationSec)
      put("optionId", option.id)
      put("kind", option.kind)
      put("label", option.label)
      put("output", option.output.name)
      put("sizeBytes", option.sizeBytes)
      option.video?.let { put("video", streamJson(it)) }
      put("audio", streamJson(option.audio))
    }

  companion object {
    private fun streamJson(s: StreamCandidate) =
      JSONObject().apply {
        put("itag", s.itag)
        put("url", s.url)
        put("container", s.container)
        put("codec", s.codec)
        put("bitrate", s.bitrate)
        put("contentLength", s.contentLength)
        put("height", s.height)
        put("fps", s.fps)
      }

    private fun stream(o: JSONObject) =
      StreamCandidate(
        itag = o.getInt("itag"),
        url = o.getString("url"),
        container = o.getString("container"),
        codec = o.getString("codec"),
        bitrate = o.getInt("bitrate"),
        contentLength = o.getLong("contentLength"),
        height = o.optInt("height"),
        fps = o.optInt("fps"),
      )

    fun create(details: VideoDetails, option: DownloadOption) =
      DownloadJob(UUID.randomUUID().toString(), details.title, details.author, details.durationSec, option)

    fun fromJson(o: JSONObject) =
      DownloadJob(
        id = o.getString("id"),
        title = o.getString("title"),
        author = o.optString("author"),
        durationSec = o.optLong("durationSec"),
        option =
          DownloadOption(
            id = o.getString("optionId"),
            kind = o.getString("kind"),
            label = o.getString("label"),
            video = o.optJSONObject("video")?.let(::stream),
            audio = stream(o.getJSONObject("audio")),
            output = OutputFormat.valueOf(o.getString("output")),
            sizeBytes = o.optLong("sizeBytes"),
          ),
      )
  }
}

/**
 * Runs one YouTube download in the foreground (dataSync), so it keeps going
 * when the app is in the background: fetch the stream(s) to the cache, join
 * them into the public Movies/Music folder, add the entry to the library.
 * Partial files are deleted on failure or cancel.
 */
class YtDownloadService : Service() {
  @Volatile private var cancelled = false
  private var worker: Thread? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_CANCEL -> {
        cancelled = true
        if (worker == null) stopSelf()
      }
      ACTION_START -> {
        val job = intent.getStringExtra(EXTRA_JOB)?.let { runCatching { DownloadJob.fromJson(JSONObject(it)) }.getOrNull() }
        if (job == null || worker != null) return START_NOT_STICKY
        startInForeground(job)
        cancelled = false
        worker = Thread({ run(job) }, "yt-download").also { it.start() }
      }
    }
    return START_NOT_STICKY
  }

  // Android 15+: dataSync services get a daily time limit.
  override fun onTimeout(startId: Int, fgsType: Int) {
    cancelled = true
  }

  private fun startInForeground(job: DownloadJob) {
    ensureChannel()
    val notification = progressNotification(job, getString(R.string.yt_notif_starting), 0, true)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun run(job: DownloadJob) {
    val work = File(cacheDir, "ytdl/${job.id}").apply { mkdirs() }
    val output = DownloadOutput(this)
    var target: DownloadOutput.Target? = null
    try {
      active = state(job, "fetching", 0f)
      val video = job.option.video
      val audio = job.option.audio
      val videoSize = video?.let { YtFormats.estimate(it, job.durationSec) } ?: 0L
      val audioSize = YtFormats.estimate(audio, job.durationSec)
      val inputs = mutableListOf<File>()
      // Video then audio; overall progress is weighted by size.
      var doneBytes = 0L
      val totalBytes = (videoSize + audioSize).coerceAtLeast(1)
      for ((stream, name) in listOfNotNull(video?.let { it to "video" }, audio to "audio")) {
        val file = File(work, "$name.${stream.container}")
        val start = doneBytes
        ChunkedFetcher({ cancelled }) { written, _ ->
          report(job, "downloading", ((start + written).toFloat() / totalBytes).coerceIn(0f, 0.97f), start + written, totalBytes)
        }.fetch(stream.url, file, stream.contentLength)
        doneBytes += file.length()
        inputs += file
      }

      report(job, "merging", 0.97f, doneBytes, totalBytes, force = true)
      val fileName = YtFormats.fileName(job.title, job.option.label, job.option.output.ext)
      val out = output.create(fileName, job.option.output, video == null).also { target = it }
      val onMux: (Float) -> Unit = { f -> report(job, "merging", 0.97f + 0.03f * f, doneBytes, totalBytes) }
      if (out.file != null) {
        StreamMuxer.mux(inputs, job.option.output, out.file.absolutePath, { cancelled }, onMux)
      } else {
        output.openWrite(out).use { pfd -> StreamMuxer.mux(inputs, job.option.output, pfd.fileDescriptor, { cancelled }, onMux) }
      }
      output.finish(out)

      val entry =
        JSONObject().apply {
          put("id", job.id)
          put("title", job.title)
          put("author", job.author)
          put("kind", job.option.kind)
          put("label", job.option.label)
          put("name", out.name)
          put("uri", out.uri.toString())
          put("mime", job.option.output.mime)
          put("sizeBytes", output.size(out))
          put("durationSec", job.durationSec)
          put("createdAt", System.currentTimeMillis())
        }
      DownloadStore.get(this).add(entry)
      YtDownloadEvents.emit("completed", JSONObject().put("entry", entry))
      notifyResult(job, getString(R.string.yt_notif_done))
    } catch (e: ChunkedFetcher.CancelledException) {
      target?.let { output.delete(it.uri) }
      YtDownloadEvents.emit("cancelled", JSONObject().put("id", job.id))
    } catch (e: Exception) {
      target?.let { output.delete(it.uri) }
      val code = errorCode(e)
      YtDownloadEvents.emit("failed", JSONObject().put("id", job.id).put("code", code))
      notifyResult(job, getString(R.string.yt_notif_failed))
    } finally {
      work.deleteRecursively()
      active = null
      worker = null
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
    }
  }

  private fun errorCode(e: Exception): String =
    when {
      e is YtException -> e.code
      e is IOException && (e.message ?: "").contains("ENOSPC") -> "storage_full"
      e is IOException -> "network"
      else -> "download_failed"
    }

  private var lastReportAt = 0L

  private fun report(job: DownloadJob, phase: String, fraction: Float, bytes: Long, total: Long, force: Boolean = false) {
    val now = SystemClock.elapsedRealtime()
    if (!force && now - lastReportAt < REPORT_INTERVAL_MS) return
    lastReportAt = now
    active = state(job, phase, fraction)
    YtDownloadEvents.emit(
      "progress",
      JSONObject().put("id", job.id).put("phase", phase).put("fraction", fraction.toDouble()).put("bytes", bytes).put("total", total),
    )
    val text = getString(if (phase == "merging") R.string.yt_notif_merging else R.string.yt_notif_downloading)
    notify(progressNotification(job, text, (fraction * 100).toInt(), false))
  }

  private fun state(job: DownloadJob, phase: String, fraction: Float) =
    JSONObject().apply {
      put("id", job.id)
      put("title", job.title)
      put("kind", job.option.kind)
      put("label", job.option.label)
      put("phase", phase)
      put("fraction", fraction.toDouble())
    }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    getSystemService(NotificationManager::class.java)?.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, getString(R.string.yt_channel_name), NotificationManager.IMPORTANCE_LOW),
    )
  }

  private fun progressNotification(job: DownloadJob, text: String, percent: Int, indeterminate: Boolean): Notification {
    val cancel =
      PendingIntent.getService(
        this,
        1,
        Intent(this, YtDownloadService::class.java).setAction(ACTION_CANCEL),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(job.title)
      .setContentText("$text · ${job.option.label}")
      .setProgress(100, percent, indeterminate)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(launchIntent())
      .addAction(0, getString(R.string.yt_action_cancel), cancel)
      .build()
  }

  private fun notifyResult(job: DownloadJob, text: String) {
    notify(
      NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_download_done)
        .setContentTitle(job.title)
        .setContentText(text)
        .setAutoCancel(true)
        .setContentIntent(launchIntent())
        .build(),
      RESULT_NOTIFICATION_ID,
    )
  }

  private fun launchIntent(): PendingIntent? =
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

  @Suppress("MissingPermission") // Guarded by areNotificationsEnabled (POST_NOTIFICATIONS on 13+).
  private fun notify(notification: Notification, id: Int = NOTIFICATION_ID) {
    val manager = NotificationManagerCompat.from(this)
    if (manager.areNotificationsEnabled()) manager.notify(id, notification)
  }

  companion object {
    private const val ACTION_START = "com.rnboilerplate.ytdownload.START"
    private const val ACTION_CANCEL = "com.rnboilerplate.ytdownload.CANCEL"
    private const val EXTRA_JOB = "job"
    private const val CHANNEL_ID = "youtube_downloads"
    private const val NOTIFICATION_ID = 4201
    private const val RESULT_NOTIFICATION_ID = 4202
    private const val REPORT_INTERVAL_MS = 400L

    /** The running download's state, or null when idle. */
    @Volatile var active: JSONObject? = null
      private set

    fun start(context: Context, job: DownloadJob) {
      active = JSONObject().put("id", job.id).put("title", job.title).put("phase", "fetching").put("fraction", 0.0)
      val intent = Intent(context, YtDownloadService::class.java).setAction(ACTION_START).putExtra(EXTRA_JOB, job.toJson().toString())
      ContextCompat.startForegroundService(context, intent)
    }

    fun cancel(context: Context) {
      if (active == null) return
      context.startService(Intent(context, YtDownloadService::class.java).setAction(ACTION_CANCEL))
    }
  }
}
