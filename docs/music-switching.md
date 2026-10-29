# Music lighting and ordinary lighting

The music tab has an explicit automatic-switching control, off by default and
remembered in local storage. Enabling it starts sampling; disabling it terminates
the native clock session, cancels queued frames and ignores pending samples.
One music component belongs to the connected device, outside the conditional
settings/tab subtrees. Navigation only hides its controls; it does not destroy
the component or stop sampling. The remembered enabled state starts when the
device connects, even if the music tab has never been opened in that session.
Disconnecting or destroying the device view terminates the clock and queued
frames. Reconnecting creates one fresh component using the remembered state.
A Windows playback peak of
at least 3/1000 for 150 ms starts music frames. While active, a peak of 1/1000
keeps the effect alive; 1500 ms of silence stops frames. An unavailable endpoint,
failed sample, or sample gap over 500 ms releases the override. The native
50 ms clock continues while the window is hidden. This detects playback audio,
including speech and other sustained sounds; it does not classify music.

Only transient command `0x32` frames are sent. Ordinary effect (`0x23`) and
custom color (`0x24`) writes are not used by automatic switching. Dropping queued
frames also checks the session generation when the HID transaction starts, so a
stale frame behind a long read cannot reactivate the override after silence.
An already running multi-packet frame completes before the firmware timeout.

## Firmware basis

Inspected the model image in PE resource 4000 of the official
`MINI68_HE_MAX_V1.73.exe`, not the unrelated generic HEX in the same package.
Image SHA256:
`998f519eaacfefb833b384fe3ed03771c17702bcd42cf870fdf3438c7bbd8f66`.
Offsets below are offsets in that image, disassembled as ARM Thumb:

- `0xFBF4–0xFC08`: accepted music frames set the transient flag at
  `0x200004B3` to 1 and renew the countdown at `0x200000A6` to 25.
- `0x10F68–0x10F7C`: the periodic loop decrements this countdown; at zero it
  clears `0x200004B3`.
- `0xD67C–0xD682`: the normal light update is bypassed while that flag is 1.
  Stopping the stream therefore allows the normal effect to resume after the
  firmware countdown. Neither saved effect settings nor saved custom colors
  are overwritten by this stream.

The separate flag at `0x200000C0`, cleared by unrelated configuration commands,
is not used as a lighting restore interface. No speculative command is sent.

This establishes the mechanism for this model image. It does not prove the
connected keyboard runs identical firmware or validate the physical RGB output.
The integration test uses real configuration reads and Windows audio, but
intercepts music packets and simulates ACKs to preserve the user's settings.
Physical visual acceptance remains a separate check.

## Verification

`node --test tests/*.test.cjs` covers attack/release timing, noise, unavailable
samples, delayed responses, lifecycle cleanup and serialized frame cancellation.
`scripts/lite-check.cjs` verifies the packaged WebView app with an isolated
profile: default off (no audio samples), mouse/keyboard toggling, stop while
playing, continued playback on ordinary lighting/performance/advanced/macro/settings pages,
silence release away from the music tab, no duplicate music instance, restored
enabled state at connection before visiting the music tab, stopped sampling and
frames after a simulated disconnect, initial silence,
playback, short silence, unavailable endpoint,
native audio while hidden for over 10 seconds, sustained silence, replay,
leaving and re-entering the tab. Native test mode remains read-only.

`scripts/lighting-ui-check.cjs` verifies the visible color wheel, HEX/RGB/preset
synchronization and custom-color packets for selected keys, with simulated ACKs.
It also checks the 14 px text minimum and color picker visibility at window
widths of 1000 and 1280 CSS pixels, along with music switch bounds and reachable
music controls after scrolling. No real configuration writes are allowed.
