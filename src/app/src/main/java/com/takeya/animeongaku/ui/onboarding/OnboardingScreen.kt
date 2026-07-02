package com.takeya.animeongaku.ui.onboarding

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.takeya.animeongaku.ui.theme.Ember400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import java.io.ByteArrayOutputStream

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OnboardingScreen(
    viewModel: OnboardingViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val backgroundGradient = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))
    var showMenu by remember { mutableStateOf(false) }
    var showImportWarning by remember { mutableStateOf(false) }
    var showRemoveImportConfirmation by remember { mutableStateOf(false) }
    val legacyImportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        readLegacyImportFile(context, uri)
            .onSuccess { file ->
                viewModel.onLegacyImportFileSelected(file.name, file.contents)
            }
            .onFailure { error ->
                viewModel.onLegacyImportReadFailed(error.message ?: "Legacy import failed: the file could not be read.")
            }
    }

    val submit: () -> Unit = {
        focusManager.clearFocus(force = true)
        keyboardController?.hide()
        viewModel.signIn()
    }

    val textFieldColors = TextFieldDefaults.colors(
        focusedTextColor = Mist100,
        unfocusedTextColor = Mist100,
        focusedContainerColor = Color.Transparent,
        unfocusedContainerColor = Color.Transparent,
        focusedIndicatorColor = Rose500,
        unfocusedIndicatorColor = Mist200.copy(alpha = 0.5f),
        focusedLabelColor = Mist200,
        unfocusedLabelColor = Mist200,
        cursorColor = Rose500
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundGradient)
    ) {
        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = 34.dp, end = 14.dp)
        ) {
            IconButton(onClick = { showMenu = true }) {
                Icon(
                    imageVector = Icons.Rounded.MoreVert,
                    contentDescription = "More options",
                    tint = Mist200
                )
            }
            DropdownMenu(
                expanded = showMenu,
                onDismissRequest = { showMenu = false }
            ) {
                DropdownMenuItem(
                    text = { Text("Import legacy library") },
                    onClick = {
                        showMenu = false
                        showImportWarning = true
                    }
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 28.dp, vertical = 48.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            Spacer(Modifier.height(24.dp))

            // Branding
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(56.dp)
                        .background(Rose500.copy(alpha = 0.18f), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Rounded.LibraryMusic, contentDescription = null, tint = Rose500)
                }
                Spacer(Modifier.width(14.dp))
                Column {
                    Text("Anime Ongaku", style = MaterialTheme.typography.headlineSmall, color = Mist100, fontWeight = FontWeight.Bold)
                    Text("Your anime opening & ending library", style = MaterialTheme.typography.bodyMedium, color = Mist200)
                }
            }

            // How it works
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Ink800.copy(alpha = 0.5f), RoundedCornerShape(16.dp))
                    .border(1.dp, Mist200.copy(alpha = 0.12f), RoundedCornerShape(16.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("How it works", style = MaterialTheme.typography.titleMedium, color = Mist100)
                HowItWorksRow("1", "Sign in with your Kitsu account.")
                HowItWorksRow("2", "Your anime list syncs and builds a library of OPs, EDs & OSTs.")
                HowItWorksRow("3", "Stream or download themes to listen anytime.")
            }

            // Sign-in card
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Ink800.copy(alpha = 0.5f), RoundedCornerShape(16.dp))
                    .border(1.dp, Mist200.copy(alpha = 0.12f), RoundedCornerShape(16.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text("Sign in to Kitsu", style = MaterialTheme.typography.titleMedium, color = Mist100)
                OutlinedTextField(
                    value = uiState.username,
                    onValueChange = viewModel::onUsernameChange,
                    label = { Text("Email or username") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    textStyle = LocalTextStyle.current.copy(color = Mist100),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    colors = textFieldColors
                )
                OutlinedTextField(
                    value = uiState.password,
                    onValueChange = viewModel::onPasswordChange,
                    label = { Text("Password") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    textStyle = LocalTextStyle.current.copy(color = Mist100),
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                    colors = textFieldColors
                )
                uiState.legacyImportFileName?.let { fileName ->
                    LegacyImportChip(
                        fileName = fileName,
                        entryCount = uiState.legacyImportEntryCount,
                        onRemove = { showRemoveImportConfirmation = true }
                    )
                }
                uiState.error?.let { error ->
                    Text(error, style = MaterialTheme.typography.bodySmall, color = Rose500)
                }
                uiState.status?.let { status ->
                    Text(status, style = MaterialTheme.typography.bodySmall, color = Mist200)
                }
                Button(
                    onClick = submit,
                    enabled = uiState.canSubmit,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Rose500,
                        contentColor = Ink900,
                        disabledContainerColor = Rose500.copy(alpha = 0.4f)
                    )
                ) {
                    if (uiState.isSubmitting) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Ink900, strokeWidth = 2.dp)
                    } else {
                        Text("Sign In", color = Ink900, fontWeight = FontWeight.SemiBold)
                    }
                }
            }

            Spacer(Modifier.height(24.dp))
        }
    }

    if (showImportWarning) {
        AlertDialog(
            onDismissRequest = { showImportWarning = false },
            title = { Text("Import legacy library?") },
            text = {
                Text(
                    "This will send the selected legacy export with sign-in and replace server likes, dislikes, and play counts for this account."
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showImportWarning = false
                        legacyImportLauncher.launch(arrayOf("application/json", "text/*", "*/*"))
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Rose500, contentColor = Ink900)
                ) {
                    Text("Choose file")
                }
            },
            dismissButton = {
                TextButton(onClick = { showImportWarning = false }) {
                    Text("Cancel")
                }
            },
            containerColor = Ink800,
            titleContentColor = Mist100,
            textContentColor = Mist200
        )
    }

    if (showRemoveImportConfirmation) {
        AlertDialog(
            onDismissRequest = { showRemoveImportConfirmation = false },
            title = { Text("Remove legacy import?") },
            text = { Text("The selected file will not be sent with sign-in.") },
            confirmButton = {
                Button(
                    onClick = {
                        showRemoveImportConfirmation = false
                        viewModel.clearLegacyImport()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Rose500, contentColor = Ink900)
                ) {
                    Text("Remove")
                }
            },
            dismissButton = {
                TextButton(onClick = { showRemoveImportConfirmation = false }) {
                    Text("Cancel")
                }
            },
            containerColor = Ink800,
            titleContentColor = Mist100,
            textContentColor = Mist200
        )
    }
}

@Composable
private fun HowItWorksRow(number: String, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier.size(24.dp).background(Ember400.copy(alpha = 0.2f), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Text(number, style = MaterialTheme.typography.labelMedium, color = Ember400, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = Mist200)
    }
}

@Composable
private fun LegacyImportChip(
    fileName: String,
    entryCount: Int,
    onRemove: () -> Unit
) {
    val shape = RoundedCornerShape(50)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ember400.copy(alpha = 0.16f), shape)
            .border(1.dp, Ember400.copy(alpha = 0.38f), shape)
            .padding(start = 12.dp, top = 6.dp, bottom = 6.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = fileName,
                style = MaterialTheme.typography.labelLarge,
                color = Mist100,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = "$entryCount legacy tracks",
                style = MaterialTheme.typography.labelSmall,
                color = Mist200,
                maxLines = 1
            )
        }
        IconButton(
            onClick = onRemove,
            modifier = Modifier.size(32.dp)
        ) {
            Icon(
                imageVector = Icons.Rounded.Close,
                contentDescription = "Remove legacy import",
                tint = Mist100,
                modifier = Modifier.size(18.dp)
            )
        }
    }
}

private data class LegacyImportFile(
    val name: String,
    val contents: String
)

private fun readLegacyImportFile(context: Context, uri: Uri): Result<LegacyImportFile> {
    return runCatching {
        val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var total = 0
            while (true) {
                val read = input.read(buffer)
                if (read == -1) break
                total += read
                if (total > LEGACY_IMPORT_MAX_BYTES) {
                    throw IllegalArgumentException("Legacy import failed: the file must be 2 MB or smaller.")
                }
                output.write(buffer, 0, read)
            }
            output.toByteArray()
        } ?: throw IllegalArgumentException("Legacy import failed: the file could not be opened.")

        LegacyImportFile(
            name = displayName(context, uri),
            contents = bytes.toString(Charsets.UTF_8)
        )
    }
}

private fun displayName(context: Context, uri: Uri): String {
    val fallback = uri.lastPathSegment?.substringAfterLast('/') ?: "legacy-library-export.json"
    return context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
        }
        ?.takeIf { it.isNotBlank() }
        ?: fallback
}

private const val LEGACY_IMPORT_MAX_BYTES = 2 * 1024 * 1024
