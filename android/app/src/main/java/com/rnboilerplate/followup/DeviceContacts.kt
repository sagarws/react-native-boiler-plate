package com.rnboilerplate.followup

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import android.provider.ContactsContract.CommonDataKinds
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * The phone's address book for "fill from contacts". [readAll] needs
 * READ_CONTACTS (asked by JS when the user taps the button); [pick] uses the
 * system picker, which grants access to the one chosen entry only and needs
 * no permission. Results go straight back to JS and are never logged or kept.
 */
object DeviceContacts {
  /** Every contact with at least one phone number, as a JSON array. */
  fun readAll(context: Context): String {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      throw SecurityException("contacts_permission")
    }
    val resolver = context.contentResolver
    val byId = LinkedHashMap<Long, JSONObject>()
    resolver.query(
      CommonDataKinds.Phone.CONTENT_URI,
      arrayOf(CommonDataKinds.Phone.CONTACT_ID, CommonDataKinds.Phone.DISPLAY_NAME, CommonDataKinds.Phone.NUMBER),
      null,
      null,
      "${CommonDataKinds.Phone.DISPLAY_NAME} COLLATE NOCASE ASC",
    )?.use { c ->
      while (c.moveToNext()) {
        val id = c.getLong(0)
        val number = c.getString(2)?.trim().orEmpty()
        if (number.isEmpty()) continue
        val o = byId.getOrPut(id) {
          JSONObject().put("id", id.toString()).put("name", c.getString(1).orEmpty()).put("phones", JSONArray())
        }
        val phones = o.getJSONArray("phones")
        val digits = number.filter { it.isDigit() }
        if ((0 until phones.length()).none { phones.getString(it).filter { ch -> ch.isDigit() } == digits }) {
          phones.put(number)
        }
      }
    }
    if (byId.isNotEmpty()) addDetails(resolver, byId)
    return JSONArray(byId.values).toString()
  }

  /** Email, organisation and birthday, in one pass over the data table. */
  private fun addDetails(resolver: ContentResolver, byId: Map<Long, JSONObject>) {
    val types = arrayOf(
      CommonDataKinds.Email.CONTENT_ITEM_TYPE,
      CommonDataKinds.Organization.CONTENT_ITEM_TYPE,
      CommonDataKinds.Event.CONTENT_ITEM_TYPE,
    )
    resolver.query(
      ContactsContract.Data.CONTENT_URI,
      arrayOf(
        ContactsContract.Data.CONTACT_ID,
        ContactsContract.Data.MIMETYPE,
        ContactsContract.Data.DATA1,
        ContactsContract.Data.DATA2,
      ),
      "${ContactsContract.Data.MIMETYPE} IN (?,?,?)",
      types,
      null,
    )?.use { c ->
      while (c.moveToNext()) {
        val o = byId[c.getLong(0)] ?: continue
        val value = c.getString(2)?.trim().orEmpty()
        if (value.isEmpty()) continue
        when (c.getString(1)) {
          types[0] -> if (!o.has("email")) o.put("email", value)
          types[1] -> if (!o.has("organization")) o.put("organization", value)
          types[2] -> if (c.getInt(3) == CommonDataKinds.Event.TYPE_BIRTHDAY) o.put("birthday", value)
        }
      }
    }
  }

  /** Reads the one row the system picker returned (name + number). */
  fun readPicked(context: Context, uri: Uri): String? {
    context.contentResolver.query(
      uri,
      arrayOf(CommonDataKinds.Phone.CONTACT_ID, CommonDataKinds.Phone.DISPLAY_NAME, CommonDataKinds.Phone.NUMBER),
      null,
      null,
      null,
    )?.use { c ->
      if (!c.moveToFirst()) return null
      return JSONObject()
        .put("id", c.getLong(0).toString())
        .put("name", c.getString(1).orEmpty())
        .put("phones", JSONArray().put(c.getString(2).orEmpty()))
        .toString()
    }
    return null
  }
}

/** Launches the system contact picker and resolves the chosen entry ('' = cancelled). */
class ContactPicker(
  private val context: ReactApplicationContext,
  private val requestCode: Int,
) : BaseActivityEventListener() {
  private var pending: Promise? = null

  fun attach() = context.addActivityEventListener(this)

  fun detach() {
    context.removeActivityEventListener(this)
    pending?.resolve("")
    pending = null
  }

  fun pick(promise: Promise) {
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("no_activity", "The app must be in the foreground")
      return
    }
    pending?.resolve("")
    pending = promise
    try {
      @Suppress("DEPRECATION")
      activity.startActivityForResult(
        Intent(Intent.ACTION_PICK, CommonDataKinds.Phone.CONTENT_URI),
        requestCode,
      )
    } catch (e: ActivityNotFoundException) {
      pending = null
      promise.reject("no_picker", "No contacts app", e)
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != this.requestCode) return
    val promise = pending ?: return
    pending = null
    val uri = data?.data
    if (resultCode != Activity.RESULT_OK || uri == null) {
      promise.resolve("")
      return
    }
    try {
      promise.resolve(DeviceContacts.readPicked(context, uri) ?: "")
    } catch (e: Exception) {
      promise.reject("read_failed", e.message ?: "Could not read the contact", e)
    }
  }
}
