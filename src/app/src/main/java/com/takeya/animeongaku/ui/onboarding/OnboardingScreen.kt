package com.takeya.animeongaku.ui.onboarding

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
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OnboardingScreen(
    onOpenServerSettings: () -> Unit,
    viewModel: OnboardingViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val backgroundGradient = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))

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

            TextButton(onClick = onOpenServerSettings) {
                Text("Server settings", color = Ember400)
            }

            Spacer(Modifier.height(24.dp))
        }
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
