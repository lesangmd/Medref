import com.medipharm.medref.RestNonceParser;

public final class RestNonceParserTest {
    private static final String EXPECTED="a1b2c3d4e5";
    private static void check(String test,boolean result){
        if(!result)throw new AssertionError(test);
        System.out.println("PASS "+test);
    }
    public static void main(String[] args) {
        check("core plain-text nonce",EXPECTED.equals(RestNonceParser.fromAjax(EXPECTED)));
        check("whitespace around nonce",EXPECTED.equals(RestNonceParser.fromAjax(" \\n"+EXPECTED+"\\n")));
        check("anonymous AJAX response",RestNonceParser.fromAjax("0")==null);
        check("HTTP error HTML",RestNonceParser.fromAjax("<html>Log in</html>")==null);
        check("unrelated config ignored",RestNonceParser.fromHtml("<script>window.other={nonce:'"+EXPECTED+"'};</script>")==null);
        check("double-quoted config",EXPECTED.equals(RestNonceParser.fromHtml("<script>window.MCR_CONFIG={\\\"restNonce\\\":\\\""+EXPECTED+"\\\"};</script>")));
        check("single-quoted config",EXPECTED.equals(RestNonceParser.fromHtml("<script>window.MCR_CONFIG={'restNonce':'"+EXPECTED+"'};</script>")));
        check("JS property",EXPECTED.equals(RestNonceParser.fromHtml("<script>window.MCR_CONFIG.restNonce='"+EXPECTED+"';</script>")));
        check("no token",RestNonceParser.fromHtml("not-a-nonce")==null);
        check("injected token rejected",RestNonceParser.fromAjax(EXPECTED+"<script>")==null);
    }
}
