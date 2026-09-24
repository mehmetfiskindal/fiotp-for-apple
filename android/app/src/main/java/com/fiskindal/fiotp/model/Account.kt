package com.fiskindal.fiotp.model

data class Account(
    val id: String,
    val issuer: String,
    val account: String,
    var secret: String,
    val algorithm: String = "SHA1",
    val digits: Int = 6,
    val period: Int = 30,
    val type: String = "totp",
    val counter: Long = 0,
    val favorite: Boolean = false,
    val tags: List<String> = emptyList(),
    val createdAt: Long = System.currentTimeMillis(),
)
