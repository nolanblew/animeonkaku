import { Camera, LogOut, Save, Settings2, Trash2, UserRound } from 'lucide-react'
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { readShowOstsOnHome, subscribeToHomePreference, writeShowOstsOnHome } from '../../lib/homePreference'
import './accountsearch.css'

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const SUPPORTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export function validateAvatarFile(file: File): string | null {
  if (!(SUPPORTED_AVATAR_TYPES as readonly string[]).includes(file.type.toLowerCase())) return 'Choose a PNG, JPEG, WebP, or GIF image.'
  if (file.size > MAX_AVATAR_BYTES) return 'Avatar images must be 2 MiB or smaller.'
  return null
}

export function SettingsPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const account = auth.me?.user ?? auth.user
  const [displayName, setDisplayName] = useState(account?.displayName ?? '')
  const [savingName, setSavingName] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'status' | 'error'; message: string } | null>(null)
  const [showOstsOnHome, setShowOstsOnHome] = useState(readShowOstsOnHome)

  useEffect(() => setDisplayName(account?.displayName ?? ''), [account?.displayName])
  useEffect(() => subscribeToHomePreference(() => setShowOstsOnHome(readShowOstsOnHome())), [])

  if (!account) {
    return <section className="account-settings-page" aria-labelledby="account-settings-title"><header className="account-settings-page__header"><p className="account-settings-page__eyebrow">Personalize</p><h1 id="account-settings-title">Account settings</h1></header><p className="account-settings-empty">Your account details are not available. Sign in again to manage settings.</p></section>
  }

  const saveDisplayName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFeedback(null)
    setSavingName(true)
    try {
      await auth.updateProfile({ displayName: displayName.trim() || null })
      setFeedback({ kind: 'status', message: 'Display name saved.' })
    } catch {
      setFeedback({ kind: 'error', message: 'We could not save your display name. Try again.' })
    } finally {
      setSavingName(false)
    }
  }

  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const validationError = validateAvatarFile(file)
    if (validationError) {
      setFeedback({ kind: 'error', message: validationError })
      return
    }
    setFeedback(null)
    setUploadingAvatar(true)
    try {
      await auth.uploadAvatar(file)
      setFeedback({ kind: 'status', message: 'Avatar updated.' })
    } catch {
      setFeedback({ kind: 'error', message: 'We could not upload your avatar. Try again.' })
    } finally {
      setUploadingAvatar(false)
    }
  }

  const removeAvatar = async () => {
    setFeedback(null)
    setUploadingAvatar(true)
    try {
      await auth.removeAvatar()
      setFeedback({ kind: 'status', message: 'Avatar removed.' })
    } catch {
      setFeedback({ kind: 'error', message: 'We could not remove your avatar. Try again.' })
    } finally {
      setUploadingAvatar(false)
    }
  }

  const logout = async () => {
    setLoggingOut(true)
    try {
      await auth.logout()
    } catch {
      // The local session is still cleared by AuthProvider; take the user to login.
    } finally {
      navigate('/login', { replace: true })
      setLoggingOut(false)
    }
  }

  const avatarLabel = account.displayName || account.username
  const syncDate = auth.me?.lastSyncAt ? formatDate(auth.me.lastSyncAt) : 'Not synced yet'

  return (
    <section className="account-settings-page" aria-labelledby="account-settings-title">
      <header className="account-settings-page__header">
        <div><p className="account-settings-page__eyebrow">Personalize</p><h1 id="account-settings-title">Account settings</h1><p>Update how your Anime Ongaku account appears across your devices.</p></div>
        <div className="account-settings-page__icon" aria-hidden="true"><Settings2 size={25} /></div>
      </header>

      <div className="account-settings-grid">
        <section className="account-settings-card" aria-labelledby="profile-title">
          <div className="account-settings-card__heading"><div><p className="account-settings-card__eyebrow">Profile</p><h2 id="profile-title">Your profile</h2></div><span className="account-settings-avatar" aria-hidden="true">{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : <UserRound size={28} />}</span></div>
          <form className="account-settings-form" onSubmit={saveDisplayName}>
            <label htmlFor="display-name">Display name</label>
            <div className="account-settings-input-row"><input id="display-name" name="displayName" type="text" maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" /><button type="submit" disabled={savingName}><Save size={16} aria-hidden="true" />{savingName ? 'Saving…' : 'Save display name'}</button></div>
          </form>
          <div className="account-settings-avatar-actions"><label className="account-settings-upload"><Camera size={17} aria-hidden="true" />{uploadingAvatar ? 'Updating…' : 'Upload avatar'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={uploadAvatar} disabled={uploadingAvatar} /></label>{account.avatarUrl && <button className="account-settings-button account-settings-button--quiet" type="button" onClick={() => void removeAvatar()} disabled={uploadingAvatar}><Trash2 size={16} aria-hidden="true" />Remove avatar</button>}</div>
          <p className="account-settings-help">PNG, JPEG, WebP, or GIF up to 2 MiB.</p>
        </section>

        <section className="account-settings-card" aria-labelledby="account-title">
          <div className="account-settings-card__heading"><div><p className="account-settings-card__eyebrow">Account</p><h2 id="account-title">Connection details</h2></div></div>
          <dl className="account-settings-details"><div><dt>Username</dt><dd>{account.username}</dd></div><div><dt>Kitsu user ID</dt><dd>{account.kitsuUserId}</dd></div><div><dt>Kitsu connection</dt><dd>{auth.me?.kitsuAuthState ?? 'Connected'}</dd></div><div><dt>Last library sync</dt><dd>{syncDate}</dd></div></dl>
        </section>

        <section className="account-settings-card account-settings-card--wide" aria-labelledby="sync-management-title">
          <div className="account-settings-card__heading"><div><p className="account-settings-card__eyebrow">Library</p><h2 id="sync-management-title">Kitsu library sync</h2></div></div>
          <p className="account-settings-help">Review progress, retry an interrupted import, or request a full library re-sync.</p>
          <NavLink className="account-settings-button" to="/sync">Manage library sync</NavLink>
        </section>

        <section className="account-settings-card" aria-labelledby="home-preferences-title">
          <div className="account-settings-card__heading"><div><p className="account-settings-card__eyebrow">Home</p><h2 id="home-preferences-title">Home preferences</h2></div></div>
          <label className="account-settings-toggle">
            <span><strong>Show OSTs on Home</strong><small>Include soundtrack songs in Recommended.</small></span>
            <input aria-label="Show OSTs on Home" type="checkbox" checked={showOstsOnHome} onChange={(event) => { setShowOstsOnHome(event.target.checked); writeShowOstsOnHome(event.target.checked) }} />
          </label>
        </section>

        <section className="account-settings-card account-settings-card--wide" aria-labelledby="devices-title">
          <div className="account-settings-card__heading"><div><p className="account-settings-card__eyebrow">Security</p><h2 id="devices-title">Signed-in devices</h2></div></div>
          {auth.me?.devices.length ? <ul className="account-settings-devices">{auth.me.devices.map((device) => <li key={device.id}><span><strong>{device.deviceName}</strong><small>Last used {formatDate(device.lastUsedAt)}{device.current ? ' · This device' : ''}</small></span><span className={device.current ? 'account-settings-device-state account-settings-device-state--current' : 'account-settings-device-state'}>{device.current ? 'Current' : 'Signed in'}</span></li>)}</ul> : <p className="account-settings-help">No device sessions were reported.</p>}
        </section>
      </div>

      <div className="account-settings-footer"><button className="account-settings-button account-settings-button--danger" type="button" onClick={() => void logout()} disabled={loggingOut}><LogOut size={17} aria-hidden="true" />{loggingOut ? 'Signing out…' : 'Sign out'}</button></div>
      {feedback && <p className={feedback.kind === 'error' ? 'account-settings-feedback account-settings-feedback--error' : 'account-settings-feedback'} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    </section>
  )
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.valueOf())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
