# Submitting ShutEye to Microsoft Edge Add-ons and Opera Add-ons

Both stores are free to publish on. Both need you to sign in with your own
account and accept their developer agreement, so this part cannot be done for
you. Everything to upload and paste is ready below.

The long description, permission reasons and privacy answers are in
`LISTING.md`. This sheet only covers what differs.

---

## Microsoft Edge Add-ons

**1. Register** (free)

Go to https://partner.microsoft.com/dashboard/microsoftedge and sign in with a
Microsoft account. Fill in the developer profile. The name you enter is shown
publicly as the publisher.

**2. Create the item**

Click **Create new extension** and upload `store/shuteye-edge.zip`.

**3. Availability**

- Visibility: **Public**
- Markets: all

**4. Properties**

- Category: **Accessibility**
- Privacy policy requirements: **Yes**, and paste
  `https://advaithsajith.github.io/shuteye/privacy/`
- Website URL: `https://advaithsajith.github.io/shuteye/`
- Support contact: `https://github.com/advaithsajith/shuteye/issues`
- Mature content: **No**

**5. Store listing** (English)

- Description: paste the Description block from `LISTING.md`.
- Extension logo (300 x 300): `store/logo-300x300.png`
- Small promotional tile (440 x 280): `store/promo-small-440x280.png`
- Large promotional tile (1400 x 560): `store/promo-marquee-1400x560.png`
- Screenshots (1280 x 800): the four `store/screenshot-*.png` files
- Short description: Edge takes this from the extension itself. Nothing to paste.
- Search terms (up to seven):

```
dark mode
dark theme
night mode
dark reader
eye strain
dracula theme
dark pdf reader
```

**6. Notes for certification** (the testers read this)

```
ShutEye darkens web pages. No account or sign-in is needed.

To test:
1. Install the extension and open any light website, for example https://en.wikipedia.org/wiki/Red_fox. The page turns dark and photos keep their real colours.
2. Click the ShutEye toolbar button. Choose another theme (for example Dracula): the open page changes straight away.
3. Use the switch at the top right of the popup to turn ShutEye off and on.
4. Click "Open the dark PDF reader" at the bottom of the popup, choose any PDF file, and it is drawn in the chosen theme.

Why it needs access to all sites: the extension's single purpose is to restyle whichever site the user visits. It only reads page colours and images to restyle them. It collects and sends no data. All code is in the package; no remote code is loaded.
```

**7. Submit.** Microsoft's review usually takes up to about a week.

---

## Opera Add-ons

**1. Register** (free)

Go to https://addons.opera.com/developer/ and sign in or create an Opera
account.

**2. Upload**

Click **Upload extension** (or **Add new**) and upload `store/shuteye-opera.zip`.

**3. Details**

- Category: **Accessibility** (or **Appearance** if offered)
- Summary:

```
Dark mode for every website, in your own theme. Photos keep their real colours. Includes a dark PDF reader.
```

- Description: paste the Description block from `LISTING.md`.
- Support page: `https://github.com/advaithsajith/shuteye/issues`
- Service / privacy policy URL: `https://advaithsajith.github.io/shuteye/privacy/`
- Licence: choose the option for your own or custom licence, and state
  "Copyright (c) 2026 Advaith Sajith. All rights reserved. Free for personal use."

**4. Images**

- Icon (64 x 64): `store/icon-64x64.png`
- Screenshots: start with the four `store/screenshot-*-640x400.png` files. If
  the form asks for a different size, the full 1280 x 800 versions are next
  to them.

**5. Submit.** Opera reviews every extension by hand, and its queue can be slow
(weeks is normal).

---

## Things to know

- **Not tested in Opera.** ShutEye was tested in Edge as an installed
  extension. Opera uses the same engine, so it should behave the same, but it
  has not been run there.
- **Field names may differ.** These sheets are written from memory of the two
  dashboards, not from a submission. Where a form asks for something not
  listed here, `LISTING.md` almost certainly has the text.
- **The zips are not stored on GitHub.** They are in the `store` folder on this
  computer. Rebuild them from `extension/` after any code change, keeping
  `manifest.json` at the top level of the zip.
- **Updating later:** raise the version number in `extension/manifest.json`,
  rebuild the zip, and upload it as an update to the same listing.
