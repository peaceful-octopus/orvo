# The page calls this through the web view, so it must not be renamed or removed.
-keepclassmembers class dev.orvo.app.ChimePlayer {
    @android.webkit.JavascriptInterface <methods>;
}
