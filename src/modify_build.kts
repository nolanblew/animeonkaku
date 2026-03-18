import java.io.File

val file = File("app/build.gradle.kts")
var content = file.readText()

val importStatements = """
import java.text.SimpleDateFormat
import java.util.Date

fun getGitHash(): String {
    return try {
        val process = ProcessBuilder("git", "rev-parse", "--short", "HEAD").start()
        process.inputStream.bufferedReader().readText().trim()
    } catch (e: Exception) {
        "00000"
    }
}

fun getDevVersion(): String {
    val df = SimpleDateFormat("yyyyMMdd-HHmm")
    val dateStr = df.format(Date())
    return "dev-${'$'}dateStr-${'$'}{getGitHash()}"
}

"""

if (!content.contains("import java.text.SimpleDateFormat")) {
    content = importStatements + content
}

val defaultVersionName = "\"1.0\""

content = content.replace(
    "versionName = \"1.0\"",
    """versionName = "1.0"
        buildConfigField("String", "DISPLAY_VERSION", "\"1.0\"")"""
)

content = content.replace(
    """    buildTypes {
        release {""",
    """    buildTypes {
        debug {
            buildConfigField("String", "DISPLAY_VERSION", "\"${'$'}{getDevVersion()}\"")
        }
        release {"""
)

file.writeText(content)
