# ADCHTI Assistant — Animated Avatar Prototype (fixed)

## Fix for the image appearing as only a mouth
The previous demo used a relative image path (`assets/avatar.webp`). When the HTML was opened by itself from Android Downloads, the browser could not find that sibling asset. The result was a broken image with only the animated mouth overlay visible.

This version embeds the compressed WebP directly inside the HTML, so the portrait loads even when the HTML file is opened alone. The mouth overlay position is also adjusted to line up with the portrait.

## Try it
Open `index.html` or the top-level `ADCHTI-Assistant-Demo.html` in a modern browser. Click **Test mouth animation** for visual-only animation, or **Play sample** to try browser speech synthesis. The browser/device may not include an Uzbek voice, so sample speech availability varies.

## Connect it to the real assistant audio
```js
// For an HTMLAudioElement playing your assistant's TTS response:
await window.ADCHTIAvatar.bindAudio(document.querySelector("#assistant-audio"));
assistantAudio.play();

// Or when your audio pipeline reports speaking state:
window.ADCHTIAvatar.setSpeaking(true);
// ...when response audio ends:
window.ADCHTIAvatar.setSpeaking(false);
```

The `bindAudio()` helper uses Web Audio to estimate output volume and animate the mouth. For cross-origin audio, configure CORS on the audio host. This is simple audio-reactive mouth motion, not phoneme-accurate lip-sync.

## About the `.riv` request
A `.riv` is a compiled Rive runtime asset, not a renamed PNG/GIF. I have not included a fake `.riv` file. To create a native Rive asset, import `assets/avatar-source.png` into [Rive Editor](https://rive.app/editor), add separated mouth artwork, rig/animate it, and export `.riv`.

## Files
- `index.html` — self-contained website demo with embedded avatar image
- `assets/avatar.webp` — compressed portrait image (used separately if desired)
- `assets/avatar-source.png` — high-resolution portrait for Rive editing
- `rive-notes/RIVE_BUILD_NOTES.txt` — notes for creating the native Rive version
