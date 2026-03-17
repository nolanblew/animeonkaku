import java.io.File

val file = File("app/build.gradle.kts")
var content = file.readText()

// Bump versionCode
val versionCodeRegex = Regex("versionCode = (\\d+)")
val versionCodeMatch = versionCodeRegex.find(content)
if (versionCodeMatch != null) {
    val currentCode = versionCodeMatch.groupValues[1].toInt()
    content = content.replace("versionCode = $currentCode", "versionCode = ${currentCode + 1}")
    println("Bumped versionCode to ${currentCode + 1}")
}

// Bump versionName (patch version)
val versionNameRegex = Regex("versionName = \"(\\d+\\.\\d+(?:\\.\\d+)?)\"")
val versionNameMatch = versionNameRegex.find(content)
if (versionNameMatch != null) {
    val currentName = versionNameMatch.groupValues[1]
    val parts = currentName.split(".")
    val newName = if (parts.size == 2) {
        "${parts[0]}.${parts[1]}.1"
    } else {
        "${parts[0]}.${parts[1]}.${parts[2].toInt() + 1}"
    }
    content = content.replace("versionName = \"$currentName\"", "versionName = \"$newName\"")
    println("Bumped versionName to $newName")
    
    // Also bump DISPLAY_VERSION
    content = content.replace("buildConfigField(\"String\", \"DISPLAY_VERSION\", \"\\\"$currentName\\\"\")", 
                             "buildConfigField(\"String\", \"DISPLAY_VERSION\", \"\\\"$newName\\\"\")")
}

file.writeText(content)
