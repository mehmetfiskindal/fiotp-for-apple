package com.fiskindal.fiotp.crypto

import com.fiskindal.fiotp.model.Account
import org.junit.Assert.assertEquals
import org.junit.Test

class OtpEngineTest {
    private val sha1Secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

    @Test fun hotpRfc4226Examples() {
        val expected = listOf("755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489")
        expected.forEachIndexed { counter, code -> assertEquals(code, OtpEngine.hotp(sha1Secret, counter.toLong())) }
    }

    @Test fun totpRfc6238ExamplesAt59Seconds() {
        val sha256 = OtpEngine.base32Encode("12345678901234567890123456789012".toByteArray())
        val sha512 = OtpEngine.base32Encode("1234567890123456789012345678901234567890123456789012345678901234".toByteArray())
        assertEquals("94287082", OtpEngine.hotp(sha1Secret, 1, "SHA1", 8))
        assertEquals("46119246", OtpEngine.hotp(sha256, 1, "SHA256", 8))
        assertEquals("90693936", OtpEngine.hotp(sha512, 1, "SHA512", 8))
    }

    @Test fun uriParserHandlesIssuerAndHotpSettings() {
        val parsed = OtpEngine.parseOtpAuth("otpauth://hotp/ACME%3Auser%40example?secret=$sha1Secret&issuer=ACME&algorithm=SHA256&digits=8&counter=41")
        assertEquals("ACME", parsed.issuer)
        assertEquals("user@example", parsed.account)
        assertEquals("SHA256", parsed.algorithm)
        assertEquals(8, parsed.digits)
        assertEquals(41L, parsed.counter)
        assertEquals("hotp", parsed.type)
    }

    @Test fun googleMigrationMultiAccountRoundTrip() {
        val accounts = listOf(
            Account("1", "Example", "alice", sha1Secret, "SHA1", 6, 30, "totp"),
            Account("2", "Other", "bob", "JBSWY3DPEHPK3PXP", "SHA512", 8, 30, "hotp", 23),
        )
        val decoded = OtpEngine.parseMigration(OtpEngine.migrationUri(accounts))
        assertEquals(2, decoded.size)
        assertEquals("alice", decoded[0].account)
        assertEquals(sha1Secret, decoded[0].secret)
        assertEquals("SHA512", decoded[1].algorithm)
        assertEquals(23L, decoded[1].counter)
        assertEquals("hotp", decoded[1].type)
    }
}
