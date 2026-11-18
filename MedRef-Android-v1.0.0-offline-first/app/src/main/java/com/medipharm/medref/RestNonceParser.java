package com.medipharm.medref;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Parses only WordPress wp_rest nonce tokens; never stores or logs session cookies. */
public final class RestNonceParser {
    private static final Pattern TOKEN = Pattern.compile("^[A-Za-z0-9]{10,32}$");
    private static final Pattern HTML_CONFIG = Pattern.compile(
            "(?:[\\\"']restNonce[\\\"']|\\brestNonce)\\s*[:=]\\s*[\\\"']([A-Za-z0-9]{10,32})[\\\"']");

    private RestNonceParser() {}

    public static String fromAjax(String response) {
        String value = response == null ? "" : response.trim();
        return TOKEN.matcher(value).matches() ? value : null;
    }

    /** Legacy fallback: accept only the exact restNonce property, not unrelated plugin nonces. */
    public static String fromHtml(String response) {
        if (response == null || response.isEmpty()) return null;
        Matcher matcher = HTML_CONFIG.matcher(response);
        return matcher.find() ? matcher.group(1) : null;
    }
}
