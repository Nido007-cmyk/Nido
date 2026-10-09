> **Language:** English · [Español](es/ROADMAP.md)

# NIDO: Public Roadmap

## Vision

A personal AI assistant designed to live on your device: private, local, and under your control.

No account required. No cloud dependency for core functionality. Personal data is stored encrypted on-device and is only shared when you explicitly choose to use features that require it, such as device-to-device communication or backup/export.

## Where we are

Alpha.

The foundation is working: on-device AI chat, encrypted memory, local tools, offline capabilities, and encrypted device-to-device communication.

Automated testing is extensive, but software tests are not a substitute for real hardware. Physical validation (including two-device P2P testing) is the current gate before NIDO is considered ready for broader release.

We document what is verified, experimental, incomplete, or still awaiting physical validation. See the README and project documentation for current status.

## Roadmap

### Now: Proving the foundation

- Validate NIDO on real Android devices
- Complete two-device P2P and offline testing
- Verify reminders, voice, encrypted memory, backup and recovery
- Improve reliability and usability based on real-device testing
- Keep every UI surface honest: no simulated functionality and no fake success states
- Fix regressions before expanding the feature set

### Next: Deepening the product

- Improve on-device understanding of time, context and follow-through
- Strengthen the NIDO-to-NIDO experience
- Continue improving voice and local interaction
- Polish the experience across English, Spanish and Portuguese
- Improve accessibility and first-time-user experience
- Expand automated and physical-device testing

### Later: Growing the ecosystem

- Prepare NIDO for a broader public release
- Google Play distribution
- Dedicated website and expanded public documentation
- Easier contribution workflows for the open-source community
- Explore additional fully local capabilities without compromising the offline-first architecture

## Principles that won't change

- Offline first. Core functionality must work without an internet connection.
- User control. Your data belongs to you and stays under your control.
- Local by default. Personal data is stored encrypted on-device unless you explicitly choose to share or export it.
- No fake features. If a capability isn't actually connected and working, the UI must not pretend that it is.
- No mandatory account. NIDO should not require an account to function.
- No tracking-based business model. NIDO will not depend on selling or profiling user activity.
- Open source. NIDO is MIT licensed and respects the attribution requirements of the projects it builds upon.

## Contributing

NIDO is being built in the open, and contributors are welcome.

We are especially interested in help with:

- Android and React Native
- On-device AI and local inference
- Privacy and application security
- Bluetooth and device-to-device communication
- Accessibility and UI/UX
- Testing on real Android hardware
- Documentation and translations

You don't need to build a major feature to contribute. Testing, bug reports, documentation improvements and small fixes are valuable too.

NIDO is still alpha software. If you want to help build a private, local-first personal AI assistant, you're welcome to join us.
