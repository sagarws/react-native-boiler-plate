package com.rnboilerplate.screenocr.share

import java.io.ByteArrayOutputStream
import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Wire protocol for sharing spoken audio with the Chrome extension
 * (mirrored in `public/crome-extension/protocol.js` — keep them in step).
 *
 * Handshake (JSON text frames, before encryption):
 *  1. client → {t:"hello", v:1, mode:"code"|"resume", pub, nonce, name}
 *  2. server → {t:"challenge", pub, nonce}
 *  3. both: Z = ECDH(P-256); keys = HKDF-SHA256(ikm=Z, salt=SHA-256(secret),
 *     info="akshar-audio-v1"‖pubC‖pubS‖nonceC‖nonceS, 96 bytes)
 *     = confirm(32) ‖ client→server(32) ‖ server→client(32). The secret is
 *     the pairing code (normalised) or the resume key.
 *  4. client → {t:"confirm", mac: HMAC(confirm, "client")}
 *  5. server → {t:"pending"|"ready", mac: HMAC(confirm, "server"), fingerprint}
 *
 * Then binary frames: counter(8, big-endian) ‖ AES-256-GCM(ciphertext‖tag),
 * nonce = direction(4) ‖ counter(8). Plaintext starts with a type byte:
 * [TYPE_JSON] utf-8 JSON, or [TYPE_PCM] sampleRate(4 BE) ‖ channels(1) ‖
 * 16-bit little-endian PCM.
 */
object ShareProtocol {
  const val VERSION = 1
  const val TYPE_JSON: Byte = 1
  const val TYPE_PCM: Byte = 2
  const val DIR_SERVER_TO_CLIENT = 1
  const val DIR_CLIENT_TO_SERVER = 2
  private const val INFO = "akshar-audio-v1"

  /** No I, O, 0, 1 — easy to read aloud and type. 32 symbols → 5 bits each. */
  const val CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const val CODE_LENGTH = 10

  private val random = SecureRandom()

  fun newCode(): String = buildString { repeat(CODE_LENGTH) { append(CODE_ALPHABET[random.nextInt(CODE_ALPHABET.length)]) } }

  /** "abcde-fghjk" → "ABCDEFGHJK"; the dash and spaces are cosmetic. */
  fun normaliseCode(input: String): String = input.uppercase().filter { it in CODE_ALPHABET }

  fun formatCode(code: String): String = if (code.length == CODE_LENGTH) code.take(5) + "-" + code.drop(5) else code

  fun randomBytes(size: Int): ByteArray = ByteArray(size).also { random.nextBytes(it) }

  fun sha256(vararg parts: ByteArray): ByteArray =
    MessageDigest.getInstance("SHA-256").run {
      parts.forEach { update(it) }
      digest()
    }

  fun hmac(key: ByteArray, data: ByteArray): ByteArray =
    Mac.getInstance("HmacSHA256").run {
      init(SecretKeySpec(key, "HmacSHA256"))
      doFinal(data)
    }

  /** RFC 5869 HKDF-SHA256. */
  fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
    val prk = hmac(salt, ikm)
    val out = ByteArrayOutputStream()
    var previous = ByteArray(0)
    var counter = 1
    while (out.size() < length) {
      previous = hmac(prk, previous + info + byteArrayOf(counter.toByte()))
      out.write(previous)
      counter++
    }
    return out.toByteArray().copyOf(length)
  }

  fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean = MessageDigest.isEqual(a, b)

  // ── P-256 ──────────────────────────────────────────────────────────────

  fun newKeyPair(): KeyPair =
    KeyPairGenerator.getInstance("EC").run {
      initialize(ECGenParameterSpec("secp256r1"))
      generateKeyPair()
    }

  /** Uncompressed point: 0x04 ‖ X(32) ‖ Y(32) — the WebCrypto "raw" format. */
  fun rawPublicKey(pair: KeyPair): ByteArray {
    val key = pair.public as ECPublicKey
    return byteArrayOf(4) + fixed32(key.w.affineX) + fixed32(key.w.affineY)
  }

  /** Shared secret (the X coordinate, 32 bytes) — what WebCrypto deriveBits(256) returns. */
  fun sharedSecret(own: KeyPair, peerRaw: ByteArray): ByteArray {
    require(peerRaw.size == 65 && peerRaw[0] == 4.toByte()) { "Bad public key" }
    val params = (own.public as ECPublicKey).params
    val point = ECPoint(BigInteger(1, peerRaw.copyOfRange(1, 33)), BigInteger(1, peerRaw.copyOfRange(33, 65)))
    val peer = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(point, params))
    return KeyAgreement.getInstance("ECDH").run {
      init(own.private)
      doPhase(peer, true)
      generateSecret()
    }
  }

  private fun fixed32(value: BigInteger): ByteArray {
    val bytes = value.toByteArray()
    return when {
      bytes.size == 32 -> bytes
      bytes.size > 32 -> bytes.copyOfRange(bytes.size - 32, bytes.size)
      else -> ByteArray(32 - bytes.size) + bytes
    }
  }

  // ── Session keys ───────────────────────────────────────────────────────

  class Keys(val confirm: ByteArray, val clientToServer: ByteArray, val serverToClient: ByteArray) {
    fun clientMac(): ByteArray = hmac(confirm, "client".toByteArray())

    fun serverMac(): ByteArray = hmac(confirm, "server".toByteArray())

    /** Six digits both screens show, so the user can match them before allowing. */
    fun fingerprint(): String {
      val h = hmac(confirm, "fingerprint".toByteArray())
      val n = ((h[0].toInt() and 0xff) shl 16) or ((h[1].toInt() and 0xff) shl 8) or (h[2].toInt() and 0xff)
      return "%06d".format(n % 1_000_000).let { it.take(3) + " " + it.drop(3) }
    }
  }

  fun deriveKeys(
    shared: ByteArray,
    secret: ByteArray,
    clientPub: ByteArray,
    serverPub: ByteArray,
    clientNonce: ByteArray,
    serverNonce: ByteArray,
  ): Keys {
    val okm = hkdf(shared, sha256(secret), INFO.toByteArray() + clientPub + serverPub + clientNonce + serverNonce, 96)
    return Keys(okm.copyOfRange(0, 32), okm.copyOfRange(32, 64), okm.copyOfRange(64, 96))
  }

  // ── Encrypted frames ───────────────────────────────────────────────────

  /** One direction of AES-GCM traffic with a strictly increasing counter. */
  class Sealer(private val key: ByteArray, private val direction: Int) {
    private var counter = 0L

    @Synchronized
    fun seal(plain: ByteArray): ByteArray {
      val n = ++counter
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce(direction, n)))
      return ByteBuffer.allocate(8).putLong(n).array() + cipher.doFinal(plain)
    }
  }

  class Opener(private val key: ByteArray, private val direction: Int) {
    private var last = 0L

    /** Plaintext, or null for a forged, corrupted or replayed frame. */
    fun open(frame: ByteArray): ByteArray? {
      if (frame.size < 8 + 16) return null
      val n = ByteBuffer.wrap(frame, 0, 8).long
      if (n <= last) return null
      return try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce(direction, n)))
        cipher.doFinal(frame, 8, frame.size - 8).also { last = n }
      } catch (_: Exception) {
        null
      }
    }
  }

  private fun nonce(direction: Int, counter: Long): ByteArray =
    ByteBuffer.allocate(12).putInt(direction).putLong(counter).array()

  fun jsonPayload(json: String): ByteArray = byteArrayOf(TYPE_JSON) + json.toByteArray(Charsets.UTF_8)

  fun pcmPayload(sampleRate: Int, channels: Int, pcm: ByteArray, offset: Int, length: Int): ByteArray {
    val buffer = ByteBuffer.allocate(6 + length)
    buffer.put(TYPE_PCM).putInt(sampleRate).put(channels.toByte()).put(pcm, offset, length)
    return buffer.array()
  }
}

/** 16-bit PCM decoded from a WAV file written by TextToSpeech.synthesizeToFile. */
class PcmClip(val sampleRate: Int, val channels: Int, val data: ByteArray) {
  val bytesPerSecond: Int
    get() = sampleRate * channels * 2

  companion object {
    /** Walks RIFF chunks for "fmt " and "data"; null if not 16-bit PCM. */
    fun fromWav(bytes: ByteArray): PcmClip? {
      if (bytes.size < 12 || String(bytes, 0, 4, Charsets.US_ASCII) != "RIFF" || String(bytes, 8, 4, Charsets.US_ASCII) != "WAVE") {
        return null
      }
      val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
      var pos = 12
      var rate = 0
      var channels = 0
      var bits = 0
      var format = 0
      while (pos + 8 <= bytes.size) {
        val id = String(bytes, pos, 4, Charsets.US_ASCII)
        val size = b.getInt(pos + 4)
        val body = pos + 8
        if (size < 0) return null
        when (id) {
          "fmt " -> {
            format = b.getShort(body).toInt()
            channels = b.getShort(body + 2).toInt()
            rate = b.getInt(body + 4)
            bits = b.getShort(body + 14).toInt()
          }
          "data" -> {
            if (format != 1 || bits != 16 || rate <= 0 || channels !in 1..2) return null
            // Some engines leave the size unset (0 or too large) while streaming.
            val end = if (size == 0 || body + size > bytes.size) bytes.size else body + size
            return PcmClip(rate, channels, bytes.copyOfRange(body, end))
          }
        }
        pos = body + size + (size and 1)
      }
      return null
    }
  }
}

/** Standard Base64 (with padding). Minimal and API-24-safe; also runs in JVM tests. */
object B64 {
  private const val CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

  fun encode(bytes: ByteArray): String {
    val out = StringBuilder((bytes.size + 2) / 3 * 4)
    var i = 0
    while (i < bytes.size) {
      val b0 = bytes[i].toInt() and 0xff
      val b1 = if (i + 1 < bytes.size) bytes[i + 1].toInt() and 0xff else 0
      val b2 = if (i + 2 < bytes.size) bytes[i + 2].toInt() and 0xff else 0
      out.append(CHARS[b0 shr 2]).append(CHARS[(b0 and 3 shl 4) or (b1 shr 4)])
      out.append(if (i + 1 < bytes.size) CHARS[(b1 and 15 shl 2) or (b2 shr 6)] else '=')
      out.append(if (i + 2 < bytes.size) CHARS[b2 and 63] else '=')
      i += 3
    }
    return out.toString()
  }

  /** Null for anything that isn't valid Base64. */
  fun decode(text: String): ByteArray? {
    val s = text.trim().trimEnd('=')
    if (s.any { CHARS.indexOf(it) < 0 } || s.length % 4 == 1) return null
    val out = ByteArrayOutputStream(s.length * 3 / 4)
    var buffer = 0
    var bits = 0
    for (c in s) {
      buffer = (buffer shl 6) or CHARS.indexOf(c)
      bits += 6
      if (bits >= 8) {
        bits -= 8
        out.write((buffer shr bits) and 0xff)
      }
    }
    return out.toByteArray()
  }
}
