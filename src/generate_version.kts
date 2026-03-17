import java.text.SimpleDateFormat
import java.util.Date

val df = SimpleDateFormat("yyyyMMdd-HHmm")
val dateStr = df.format(Date())

// We use the git commit hash
val process = ProcessBuilder("git", "rev-parse", "--short", "HEAD").start()
val hash = process.inputStream.bufferedReader().readText().trim()

val finalHash = if (hash.isNotEmpty()) hash else "00000"
println("dev-$dateStr-$finalHash")
