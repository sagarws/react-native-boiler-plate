package com.rnboilerplate.screenocr.share

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareProtocolTest {
  private fun hex(s: String) = s.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

  @Test
  fun base64MatchesTheJdk() {
    for (size in 0..40) {
      val bytes = ByteArray(size) { (it * 37 + 11).toByte() }
      val expected = java.util.Base64.getEncoder().encodeToString(bytes)
      assertEquals(expected, B64.encode(bytes))
      assertArrayEquals(bytes, B64.decode(expected))
    }
    assertNull(B64.decode("not base64!"))
  }

  @Test
  fun hkdfMatchesRfc5869TestCase1() {
    val okm =
      ShareProtocol.hkdf(
        ikm = hex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"),
        salt = hex("000102030405060708090a0b0c"),
        info = hex("f0f1f2f3f4f5f6f7f8f9"),
        length = 42,
      )
    assertArrayEquals(
      hex("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"),
      okm,
    )
  }

  @Test
  fun bothSidesDeriveTheSameKeysOnlyWithTheSameSecret() {
    val client = ShareProtocol.newKeyPair()
    val server = ShareProtocol.newKeyPair()
    val cPub = ShareProtocol.rawPublicKey(client)
    val sPub = ShareProtocol.rawPublicKey(server)
    assertEquals(65, cPub.size)
    val cNonce = ShareProtocol.randomBytes(16)
    val sNonce = ShareProtocol.randomBytes(16)
    val code = ShareProtocol.PAIR_SECRET
    val onClient = ShareProtocol.deriveKeys(ShareProtocol.sharedSecret(client, sPub), code, cPub, sPub, cNonce, sNonce)
    val onServer = ShareProtocol.deriveKeys(ShareProtocol.sharedSecret(server, cPub), code, cPub, sPub, cNonce, sNonce)
    assertArrayEquals(onClient.clientMac(), onServer.clientMac())
    assertEquals(onClient.fingerprint(), onServer.fingerprint())
    assertTrue(onClient.fingerprint().matches(Regex("\\d{3} \\d{3}")))

    val wrong = ShareProtocol.deriveKeys(ShareProtocol.sharedSecret(client, sPub), "other".toByteArray(), cPub, sPub, cNonce, sNonce)
    assertFalse(ShareProtocol.constantTimeEquals(wrong.clientMac(), onServer.clientMac()))
  }

  @Test
  fun framesDecryptOnceAndRejectTamperingAndReplay() {
    val key = ShareProtocol.randomBytes(32)
    val sealer = ShareProtocol.Sealer(key, ShareProtocol.DIR_SERVER_TO_CLIENT)
    val opener = ShareProtocol.Opener(key, ShareProtocol.DIR_SERVER_TO_CLIENT)
    val first = sealer.seal(ShareProtocol.jsonPayload("""{"t":"ping"}"""))
    val second = sealer.seal(ShareProtocol.jsonPayload("""{"t":"flush"}"""))
    assertEquals("""{"t":"ping"}""", String(opener.open(first)!!, 1, 12 - 0))
    assertNull("replay", opener.open(first))
    val tampered = second.copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() }
    assertNull("tampered", opener.open(tampered))
    assertNotNull(opener.open(second))
    // The other direction's key/nonce never opens it.
    assertNull(ShareProtocol.Opener(key, ShareProtocol.DIR_CLIENT_TO_SERVER).open(sealer.seal(byteArrayOf(1))))
  }

  @Test
  fun pcmPayloadCarriesFormat() {
    val payload = ShareProtocol.pcmPayload(24000, 1, byteArrayOf(9, 8, 7, 6), 1, 2)
    val b = ByteBuffer.wrap(payload)
    assertEquals(ShareProtocol.TYPE_PCM, b.get())
    assertEquals(24000, b.int)
    assertEquals(1.toByte(), b.get())
    assertEquals(8.toByte(), b.get())
    assertEquals(7.toByte(), b.get())
  }

  private fun wav(rate: Int, channels: Int, bits: Int, data: ByteArray, extraChunk: Boolean = false): ByteArray {
    val out = ByteArrayOutputStream()
    fun le(n: Int, size: Int) = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN).apply {
      if (size == 2) putShort(n.toShort()) else putInt(n)
    }.array()
    out.write("RIFF".toByteArray()); out.write(le(0, 4)); out.write("WAVE".toByteArray())
    out.write("fmt ".toByteArray()); out.write(le(16, 4)); out.write(le(1, 2)); out.write(le(channels, 2))
    out.write(le(rate, 4)); out.write(le(rate * channels * bits / 8, 4)); out.write(le(channels * bits / 8, 2)); out.write(le(bits, 2))
    if (extraChunk) {
      out.write("LIST".toByteArray()); out.write(le(3, 4)); out.write(byteArrayOf(1, 2, 3, 0))
    }
    out.write("data".toByteArray()); out.write(le(data.size, 4)); out.write(data)
    return out.toByteArray()
  }

  @Test
  fun readsTtsWavFiles() {
    val clip = PcmClip.fromWav(wav(24000, 1, 16, byteArrayOf(1, 2, 3, 4), extraChunk = true))!!
    assertEquals(24000, clip.sampleRate)
    assertEquals(1, clip.channels)
    assertArrayEquals(byteArrayOf(1, 2, 3, 4), clip.data)
    assertEquals(48000, clip.bytesPerSecond)
    assertNull("8-bit is not supported", PcmClip.fromWav(wav(16000, 1, 8, byteArrayOf(1))))
    assertNull(PcmClip.fromWav("garbage".toByteArray()))
  }

  /**
   * Vectors produced by the Chrome extension's protocol.js (WebCrypto in
   * Node): proves the two implementations agree on P-256 raw keys, ECDH,
   * HKDF/HMAC derivation, the fingerprint and AES-GCM framing.
   */
  @Test
  fun interoperatesWithTheExtensionsWebCrypto() {
    val aPub = hex("040234b57925b979c01ad759b220791e837b29980b026b61cd4e3c422f639c3e48823c4e8c51273653dea7b0fc6c05a96a1e554a00b8d3fc951358069fe07e96b3")
    val bPub = hex("04a280bf1a74cb4fd75990406575c97a4bad9ddc6bee0949512f54ec181caf0378e2b1911a0ed5cc7dd5af164d1affcfb6116ebea0c311ee125dcdfb2855606087")
    val aD = java.math.BigInteger(1, hex("b88a508adb8315203831b0e37bd8857dcaefb8b15d2816e56a0244469e0227e5"))
    val params = (ShareProtocol.newKeyPair().public as java.security.interfaces.ECPublicKey).params
    val kf = java.security.KeyFactory.getInstance("EC")
    val aPair =
      java.security.KeyPair(
        kf.generatePublic(
          java.security.spec.ECPublicKeySpec(
            java.security.spec.ECPoint(java.math.BigInteger(1, aPub.copyOfRange(1, 33)), java.math.BigInteger(1, aPub.copyOfRange(33, 65))),
            params,
          ),
        ),
        kf.generatePrivate(java.security.spec.ECPrivateKeySpec(aD, params)),
      )
    assertArrayEquals(aPub, ShareProtocol.rawPublicKey(aPair))
    val z = ShareProtocol.sharedSecret(aPair, bPub)
    assertArrayEquals(hex("5afccdd4338e50e0ac93fb70d5fa5aac1e2a70e08d1722e8de8753c2ae93233d"), z)

    val cn = ByteArray(16) { ((1 + it * 7) and 255).toByte() }
    val sn = ByteArray(16) { ((2 + it * 7) and 255).toByte() }
    val keys = ShareProtocol.deriveKeys(z, "ABCDE23456".toByteArray(), aPub, bPub, cn, sn)
    assertArrayEquals(hex("3c0c7cdf9e699af04197451d9e31d479fa130efbc2b55b9cac0e736f23d51e82"), keys.clientMac())
    assertArrayEquals(hex("35d61acbb63bd14619f2385017da25d976ef966179698c770cfbe5700dee00de"), keys.serverMac())
    assertArrayEquals(hex("9e6c6d6b32a6216d199db6a7baf5a5aac87085024b9cbced1670c6779a1bbe5e"), keys.serverToClient)
    assertEquals("910 030", keys.fingerprint())

    val frame = hex("000000000000000134ffdd8d3e4b99441a9554dc80d1358a3750f1bbbf0ddffcb17fd2a9ee80003b4748d77acd5bcd0ad2")
    val plain = ShareProtocol.Opener(keys.clientToServer, ShareProtocol.DIR_CLIENT_TO_SERVER).open(frame)!!
    assertEquals(ShareProtocol.TYPE_JSON, plain[0])
    assertEquals("""{"t":"listen","on":true}""", String(plain, 1, plain.size - 1))
  }

  // ── WebSocket ──

  private fun clientFrame(opcode: Int, payload: ByteArray, fin: Boolean = true): ByteArray {
    val mask = byteArrayOf(0x11, 0x22, 0x33, 0x44)
    val out = ByteArrayOutputStream()
    out.write((if (fin) 0x80 else 0) or opcode)
    if (payload.size < 126) out.write(0x80 or payload.size) else {
      out.write(0x80 or 126); out.write(payload.size shr 8); out.write(payload.size and 0xff)
    }
    out.write(mask)
    out.write(ByteArray(payload.size) { (payload[it].toInt() xor mask[it % 4].toInt()).toByte() })
    return out.toByteArray()
  }

  @Test
  fun readsMaskedFramesAnswersPingsAndReassembles() {
    val input =
      ByteArrayInputStream(
        clientFrame(9, "hi".toByteArray()) +
          clientFrame(1, "Hel".toByteArray(), fin = false) +
          clientFrame(0, "lo".toByteArray()) +
          clientFrame(2, ByteArray(300) { 7 }) +
          clientFrame(8, byteArrayOf(3, -24)),
      )
    val output = ByteArrayOutputStream()
    val ws = WebSocketConnection(input, output)
    assertEquals("Hello", (ws.read() as WebSocketConnection.Message.Text).text)
    assertEquals(300, (ws.read() as WebSocketConnection.Message.Binary).bytes.size)
    assertNull(ws.read())
    // Pong with the ping's payload, then a close reply.
    val written = output.toByteArray()
    assertEquals(0x8A.toByte(), written[0])
    assertEquals("hi", String(written, 2, 2))
  }

  @Test
  fun sendsServerFramesUnmasked() {
    val output = ByteArrayOutputStream()
    WebSocketConnection(ByteArrayInputStream(ByteArray(0)), output).sendBinary(ByteArray(200))
    val b = output.toByteArray()
    assertEquals(0x82.toByte(), b[0])
    assertEquals(126.toByte(), b[1])
    assertEquals(200, ((b[2].toInt() and 0xff) shl 8) or (b[3].toInt() and 0xff))
    assertEquals(4 + 200, b.size)
  }

  @Test
  fun upgradeFollowsRfc6455AndRefusesWebPages() {
    assertEquals("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", WebSocketConnection.acceptKey("dGhlIHNhbXBsZSBub25jZQ=="))
    val request = "GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: abc\r\nOrigin: chrome-extension://xyz\r\n\r\n"
    val (line, headers) = WebSocketConnection.readRequest(ByteArrayInputStream(request.toByteArray()))!!
    assertNull(WebSocketConnection.rejectReason(line, headers))
    assertEquals("403 Forbidden", WebSocketConnection.rejectReason(line, headers + ("origin" to "https://evil.example")))
    assertEquals("426 Upgrade Required", WebSocketConnection.rejectReason(line, headers - "upgrade"))
  }
}
