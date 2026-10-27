package com.rnboilerplate.screenocr

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Stores the user's Gemini API key encrypted with an AES-256-GCM key that
 * lives in the Android Keystore (hardware-backed where the device supports
 * it) and never leaves it. The ciphertext sits in private SharedPreferences;
 * `allowBackup="false"` keeps it out of backups.
 *
 * The plain key is only ever returned to native code that calls Gemini —
 * JS gets [hint] (last four characters) and [hasKey].
 */
class SecureKeyStore(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  private fun secretKey(): SecretKey {
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    (keyStore.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  fun save(apiKey: String): Boolean =
    try {
      val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, secretKey()) }
      val sealed = cipher.doFinal(apiKey.trim().toByteArray(Charsets.UTF_8))
      prefs.edit()
        .putString(K_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
        .putString(K_DATA, Base64.encodeToString(sealed, Base64.NO_WRAP))
        .putString(K_HINT, apiKey.trim().takeLast(4))
        .apply()
      true
    } catch (_: Exception) {
      false
    }

  /** The plain key, for the Gemini request only. Null if none or unreadable. */
  fun read(): String? {
    val iv = prefs.getString(K_IV, null) ?: return null
    val data = prefs.getString(K_DATA, null) ?: return null
    return try {
      val cipher =
        Cipher.getInstance(TRANSFORMATION).apply {
          init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        }
      String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8)
    } catch (_: Exception) {
      null
    }
  }

  val hasKey: Boolean
    get() = prefs.contains(K_DATA)

  val hint: String
    get() = prefs.getString(K_HINT, "").orEmpty()

  fun clear() {
    prefs.edit().clear().apply()
  }

  private companion object {
    const val FILE = "screen_ocr_secure"
    const val ANDROID_KEYSTORE = "AndroidKeyStore"
    const val ALIAS = "akshar_gemini_key"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val K_IV = "iv"
    const val K_DATA = "data"
    const val K_HINT = "hint"
  }
}
