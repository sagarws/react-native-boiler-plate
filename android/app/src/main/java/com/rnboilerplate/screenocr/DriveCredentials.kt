package com.rnboilerplate.screenocr

import android.content.Context
import android.os.Handler
import android.os.Looper
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.net.UnknownHostException
import java.util.concurrent.Executors
import org.json.JSONException
import org.json.JSONObject

/**
 * The shared Google Drive File Management uses when no personal Google
 * account is connected: an OAuth client + refresh token + folder, entered by
 * the user in Settings → File Management.
 */
data class DriveCredentials(
  val clientId: String,
  val clientSecret: String,
  val refreshToken: String,
  val folderId: String,
) {
  fun toJson(): String =
    JSONObject()
      .put("clientId", clientId)
      .put("clientSecret", clientSecret)
      .put("refreshToken", refreshToken)
      .put("folderId", folderId)
      .toString()

  companion object {
    fun fromJson(json: String): DriveCredentials? =
      try {
        val o = JSONObject(json)
        DriveCredentials(
          o.optString("clientId"),
          o.optString("clientSecret"),
          o.optString("refreshToken"),
          o.optString("folderId"),
        ).takeIf { it.isComplete }
      } catch (_: JSONException) {
        null
      }

    /**
     * Applies a Settings update to what is stored: a blank secret field keeps
     * the stored value (so the user can change only the folder, say). Null
     * when the result is incomplete or a value is malformed.
     */
    fun merge(stored: DriveCredentials?, update: JSONObject): DriveCredentials? {
      fun field(name: String, current: String?) =
        update.optString(name).trim().ifEmpty { current.orEmpty() }
      val merged =
        DriveCredentials(
          clientId = field("clientId", stored?.clientId),
          clientSecret = field("clientSecret", stored?.clientSecret),
          refreshToken = field("refreshToken", stored?.refreshToken),
          folderId = folderIdFrom(field("folderId", stored?.folderId)),
        )
      return merged.takeIf { it.isComplete && it.isWellFormed }
    }

    /** Accepts a bare id or a Drive folder URL. */
    fun folderIdFrom(input: String): String =
      Regex("""folders/([A-Za-z0-9_-]+)""").find(input)?.groupValues?.get(1) ?: input.trim()
  }

  val isComplete: Boolean
    get() = clientId.isNotBlank() && clientSecret.isNotBlank() && refreshToken.isNotBlank() && folderId.isNotBlank()

  val isWellFormed: Boolean
    get() =
      clientId.endsWith(".apps.googleusercontent.com") &&
        clientId.length <= 200 &&
        clientSecret.length in 10..200 &&
        refreshToken.length in 20..1024 &&
        Regex("""[A-Za-z0-9_-]{10,200}""").matches(folderId)
}

/**
 * Encrypted storage for [DriveCredentials] (Android Keystore, see
 * [SecureKeyStore]). The client id and folder id are not secret and are kept
 * in clear for display; the secret and refresh token are only shown as the
 * last four characters.
 *
 * Defaults: the build's `.env` may set GOOGLE_DRIVE_CLIENT_ID,
 * GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN and
 * GOOGLE_DRIVE_FOLDER_ID (react-native-config turns them into string
 * resources). They apply until the user saves their own values, and stop
 * applying after "Remove" until restored. Note: values in `.env` are inside
 * the APK — fine for a personal build, not for a public one.
 */
class DriveCredentialStore(private val context: Context) {
  private val secure = SecureKeyStore(context, FILE_SECURE, ALIAS)
  private val display = context.applicationContext.getSharedPreferences(FILE_DISPLAY, Context.MODE_PRIVATE)

  private fun saved(): DriveCredentials? = secure.read()?.let { DriveCredentials.fromJson(it) }

  /** The build's `.env` defaults, looked up by name so a missing key just means "none". */
  fun defaults(): DriveCredentials? {
    fun value(name: String): String {
      val id = context.resources.getIdentifier(name, "string", context.packageName)
      return if (id == 0) "" else context.getString(id).trim()
    }
    return DriveCredentials(
      value("GOOGLE_DRIVE_CLIENT_ID"),
      value("GOOGLE_DRIVE_CLIENT_SECRET"),
      value("GOOGLE_DRIVE_REFRESH_TOKEN"),
      DriveCredentials.folderIdFrom(value("GOOGLE_DRIVE_FOLDER_ID")),
    ).takeIf { it.isComplete }
  }

  private val defaultsDisabled: Boolean
    get() = display.getBoolean(K_DEFAULTS_OFF, false)

  /** Saved values, else the build defaults (unless removed). */
  fun read(): DriveCredentials? = saved() ?: if (defaultsDisabled) null else defaults()

  fun save(credentials: DriveCredentials): Boolean {
    if (!secure.save(credentials.toJson())) return false
    display.edit()
      .putString(K_CLIENT_ID, credentials.clientId)
      .putString(K_FOLDER_ID, credentials.folderId)
      .putString(K_SECRET_HINT, credentials.clientSecret.takeLast(4))
      .putString(K_TOKEN_HINT, credentials.refreshToken.takeLast(4))
      .putBoolean(K_DEFAULTS_OFF, false)
      .apply()
    return true
  }

  /** Forgets saved values and stops using the build defaults. */
  fun clear() {
    secure.clear()
    display.edit().clear().putBoolean(K_DEFAULTS_OFF, true).apply()
  }

  /** Forgets saved values and goes back to the build defaults. */
  fun restoreDefaults() {
    secure.clear()
    display.edit().clear().apply()
  }

  /** What Settings may show. Never the secret or the token. */
  fun statusJson(): JSONObject {
    val stored = saved()
    val active = stored ?: if (defaultsDisabled) null else defaults()
    return JSONObject()
      .put("configured", active != null)
      .put("source", if (stored != null) "saved" else if (active != null) "default" else "none")
      .put("hasDefaults", defaults() != null)
      .put("clientId", active?.clientId.orEmpty())
      .put("folderId", active?.folderId.orEmpty())
      .put("secretHint", active?.clientSecret?.takeLast(4).orEmpty())
      .put("tokenHint", active?.refreshToken?.takeLast(4).orEmpty())
  }

  private companion object {
    const val FILE_SECURE = "drive_secure"
    const val FILE_DISPLAY = "drive_display"
    const val ALIAS = "akshar_drive_credentials"
    const val K_CLIENT_ID = "clientId"
    const val K_FOLDER_ID = "folderId"
    const val K_SECRET_HINT = "secretHint"
    const val K_TOKEN_HINT = "tokenHint"
    const val K_DEFAULTS_OFF = "defaultsOff"
  }
}

/** Why a token could not be obtained, as a code JS can explain. */
class DriveTokenException(val code: String, val detail: String = "") : Exception(code)

/**
 * Exchanges the refresh token for short-lived access tokens (Google's OAuth
 * token endpoint), cached until shortly before they expire. Only the access
 * token ever reaches JS. Nothing is logged.
 */
class DriveTokenClient {
  private val executor = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var cached: Pair<String, Long>? = null
  @Volatile private var cachedFor: String? = null

  fun invalidate() {
    cached = null
    cachedFor = null
  }

  fun accessToken(credentials: DriveCredentials, forceRefresh: Boolean, onResult: (Result<String>) -> Unit) {
    val identity = credentials.clientId + credentials.refreshToken.takeLast(8)
    val hit = cached
    if (!forceRefresh && hit != null && cachedFor == identity && System.currentTimeMillis() < hit.second) {
      onResult(Result.success(hit.first))
      return
    }
    executor.execute {
      val result = runCatching { exchange(credentials) }
      result.getOrNull()?.let {
        cached = it
        cachedFor = identity
      }
      main.post { onResult(result.map { it.first }) }
    }
  }

  private fun exchange(c: DriveCredentials): Pair<String, Long> {
    fun enc(v: String) = URLEncoder.encode(v, "UTF-8")
    val body =
      "client_id=${enc(c.clientId)}&client_secret=${enc(c.clientSecret)}" +
        "&refresh_token=${enc(c.refreshToken)}&grant_type=refresh_token"
    val conn = URL(TOKEN_URL).openConnection() as HttpURLConnection
    try {
      conn.requestMethod = "POST"
      conn.connectTimeout = 10_000
      conn.readTimeout = 20_000
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
      conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      val status = conn.responseCode
      val text = (if (status in 200..299) conn.inputStream else conn.errorStream)
        ?.bufferedReader()?.use { it.readText() }.orEmpty()
      val json = try { JSONObject(text) } catch (_: JSONException) { JSONObject() }
      if (status !in 200..299) {
        val error = json.optString("error")
        throw DriveTokenException(
          when (error) {
            "invalid_grant" -> "invalid_token"
            "invalid_client", "unauthorized_client" -> "invalid_client"
            else -> "server"
          },
          json.optString("error_description").take(200),
        )
      }
      val token = json.optString("access_token")
      if (token.isEmpty()) throw DriveTokenException("server", "No access token returned")
      val expiresIn = json.optLong("expires_in", 3600)
      return token to System.currentTimeMillis() + (expiresIn - 120).coerceAtLeast(60) * 1000
    } catch (e: DriveTokenException) {
      throw e
    } catch (_: UnknownHostException) {
      throw DriveTokenException("no_internet")
    } catch (_: SocketTimeoutException) {
      throw DriveTokenException("timeout")
    } catch (_: IOException) {
      throw DriveTokenException("no_internet")
    } finally {
      conn.disconnect()
    }
  }

  fun shutdown() = executor.shutdownNow()

  private companion object {
    const val TOKEN_URL = "https://oauth2.googleapis.com/token"
  }
}
