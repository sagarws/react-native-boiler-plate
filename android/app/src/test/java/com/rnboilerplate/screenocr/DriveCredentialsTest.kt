package com.rnboilerplate.screenocr

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DriveCredentialsTest {
  // Made-up values in the right shapes — never real credentials.
  private val stored =
    DriveCredentials(
      clientId = "1234567890-abcdef.apps.googleusercontent.com",
      clientSecret = "TEST-secret-0000",
      refreshToken = "1//test-refresh-token-000000",
      folderId = "TestFolderId_0123456789",
    )

  @Test
  fun roundTripsThroughJson() {
    assertEquals(stored, DriveCredentials.fromJson(stored.toJson()))
    assertNull(DriveCredentials.fromJson("""{"clientId":"x"}"""))
    assertNull(DriveCredentials.fromJson("not json"))
  }

  @Test
  fun blankFieldsKeepStoredSecretsSoOneValueCanChange() {
    val merged = DriveCredentials.merge(stored, JSONObject().put("folderId", "OtherFolder_9876543210").put("clientSecret", "  "))
    assertEquals(stored.copy(folderId = "OtherFolder_9876543210"), merged)
  }

  @Test
  fun acceptsAFolderUrl() {
    assertEquals("Abc_def-1234567890", DriveCredentials.folderIdFrom("https://drive.google.com/drive/folders/Abc_def-1234567890?usp=sharing"))
    assertEquals("Abc_def-1234567890", DriveCredentials.folderIdFrom("  Abc_def-1234567890 "))
  }

  @Test
  fun rejectsIncompleteOrMalformedValues() {
    // Nothing stored and only some fields given.
    assertNull(DriveCredentials.merge(null, JSONObject().put("clientId", stored.clientId)))
    // Not a Google OAuth client id.
    assertNull(DriveCredentials.merge(stored, JSONObject().put("clientId", "my-client")))
    // Folder id with illegal characters.
    assertNull(DriveCredentials.merge(stored, JSONObject().put("folderId", "bad id!")))
  }
}
