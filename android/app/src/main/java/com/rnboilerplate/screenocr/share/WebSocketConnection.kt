package com.rnboilerplate.screenocr.share

import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest


/**
 * Just enough RFC 6455 for one browser client on the local network: the
 * HTTP upgrade, masked client frames, text/binary/ping/pong/close. No
 * extensions or fragmentation-on-send; incoming fragments are reassembled.
 */
class WebSocketConnection(private val input: InputStream, private val output: OutputStream) {
  sealed class Message {
    class Text(val text: String) : Message()

    class Binary(val bytes: ByteArray) : Message()
  }

  @Synchronized
  fun sendText(text: String) = send(OP_TEXT, text.toByteArray(Charsets.UTF_8))

  @Synchronized
  fun sendBinary(bytes: ByteArray) = send(OP_BINARY, bytes)

  @Synchronized
  fun sendClose(code: Int = 1000) =
    try {
      send(OP_CLOSE, byteArrayOf((code shr 8).toByte(), code.toByte()))
    } catch (_: IOException) {
      // Already gone.
    }

  private fun send(opcode: Int, payload: ByteArray) {
    val header = ByteArrayOutputStream()
    header.write(0x80 or opcode)
    when {
      payload.size < 126 -> header.write(payload.size)
      payload.size < 65536 -> {
        header.write(126)
        header.write(payload.size shr 8)
        header.write(payload.size and 0xff)
      }
      else -> {
        header.write(127)
        for (shift in 56 downTo 0 step 8) header.write(((payload.size.toLong() shr shift) and 0xff).toInt())
      }
    }
    output.write(header.toByteArray())
    output.write(payload)
    output.flush()
  }

  /** The next data message; answers pings itself. Null when the peer closed. */
  fun read(): Message? {
    val assembled = ByteArrayOutputStream()
    var messageOp = -1
    while (true) {
      val b0 = readByte()
      val b1 = readByte()
      val fin = b0 and 0x80 != 0
      val opcode = b0 and 0x0f
      val masked = b1 and 0x80 != 0
      var length = (b1 and 0x7f).toLong()
      if (length == 126L) length = ((readByte() shl 8) or readByte()).toLong()
      else if (length == 127L) {
        length = 0
        repeat(8) { length = (length shl 8) or readByte().toLong() }
      }
      if (!masked) throw IOException("Client frames must be masked")
      if (length > MAX_MESSAGE) throw IOException("Frame too large")
      val mask = readFully(4)
      val payload = readFully(length.toInt())
      for (i in payload.indices) payload[i] = (payload[i].toInt() xor mask[i % 4].toInt()).toByte()
      when (opcode) {
        OP_CLOSE -> {
          sendClose()
          return null
        }
        OP_PING -> synchronized(this) { send(OP_PONG, payload) }
        OP_PONG -> Unit
        OP_TEXT, OP_BINARY, OP_CONTINUATION -> {
          if (opcode != OP_CONTINUATION) messageOp = opcode
          assembled.write(payload)
          if (assembled.size() > MAX_MESSAGE) throw IOException("Message too large")
          if (fin) {
            val bytes = assembled.toByteArray()
            return if (messageOp == OP_TEXT) Message.Text(String(bytes, Charsets.UTF_8)) else Message.Binary(bytes)
          }
        }
        else -> throw IOException("Unknown opcode $opcode")
      }
    }
  }

  private fun readByte(): Int {
    val b = input.read()
    if (b < 0) throw EOFException()
    return b
  }

  private fun readFully(size: Int): ByteArray {
    val out = ByteArray(size)
    var read = 0
    while (read < size) {
      val n = input.read(out, read, size - read)
      if (n < 0) throw EOFException()
      read += n
    }
    return out
  }

  companion object {
    private const val OP_CONTINUATION = 0
    private const val OP_TEXT = 1
    private const val OP_BINARY = 2
    private const val OP_CLOSE = 8
    private const val OP_PING = 9
    private const val OP_PONG = 10
    private const val MAX_MESSAGE = 64 * 1024
    private const val MAX_HEADER = 8 * 1024
    private const val GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    /** Request line + headers (lower-cased names), or null when malformed. */
    fun readRequest(input: InputStream): Pair<String, Map<String, String>>? {
      val raw = ByteArrayOutputStream()
      var tail = 0
      while (true) {
        val b = input.read()
        if (b < 0 || raw.size() > MAX_HEADER) return null
        raw.write(b)
        tail = (tail shl 8) or b
        if (tail == 0x0d0a0d0a) break
      }
      val lines = String(raw.toByteArray(), Charsets.ISO_8859_1).split("\r\n").filter { it.isNotEmpty() }
      if (lines.isEmpty()) return null
      val headers =
        lines.drop(1).mapNotNull { line ->
          val i = line.indexOf(':')
          if (i <= 0) null else line.substring(0, i).trim().lowercase() to line.substring(i + 1).trim()
        }.toMap()
      return lines[0] to headers
    }

    /**
     * Why an upgrade request is refused, or null to accept. Web pages (any
     * http/https Origin) are refused; the extension sends chrome-extension://.
     */
    fun rejectReason(requestLine: String, headers: Map<String, String>): String? {
      if (!requestLine.startsWith("GET ")) return "405 Method Not Allowed"
      if (headers["upgrade"]?.lowercase() != "websocket") return "426 Upgrade Required"
      if (headers["sec-websocket-key"].isNullOrBlank()) return "400 Bad Request"
      val origin = headers["origin"]
      if (origin != null && !origin.startsWith("chrome-extension://")) return "403 Forbidden"
      return null
    }

    fun acceptKey(key: String): String =
      B64.encode(MessageDigest.getInstance("SHA-1").digest((key.trim() + GUID).toByteArray()))

    fun upgradeResponse(key: String): String =
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n"
  }
}
