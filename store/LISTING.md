# Chrome Web Store listing for ShutEye

Everything to paste into the Chrome Web Store developer dashboard, in the order
the dashboard asks for it. The same text and images work for Microsoft Edge
Add-ons.

## Before you start

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the
   Google account you want to own the listing.
2. Pay the one-time developer registration fee (US$5 at the time of writing)
   and verify your email address. Google requires this of every publisher.
3. Click **New item** and upload `store/shuteye-chrome-web-store.zip`.

Rebuild that zip after any code change. It is the contents of `extension/`
with `manifest.json` at the top level (not inside a folder).

## Store listing tab

**Name** (taken from the manifest)

```
ShutEye
```

**Summary** (132 characters maximum; this one is 107)

```
Dark mode for every website, in your own theme. Photos keep their real colours. Includes a dark PDF reader.
```

**Description**

```
ShutEye turns any website dark, in a theme you choose, without wrecking the pictures.

WHAT IT DOES
• Darkens every site, including long articles, forums and documentation.
• Keeps photos and video in their real colours. Diagrams, formulas and scanned pages go dark with the page.
• Leaves sites alone that are already dark, and keeps dark headers and code boxes dark instead of flipping them to white.

MAKE IT YOURS
• 25 themes, including Midnight (true black for OLED), Dracula, Monokai, Nord, Tokyo Night, Catppuccin, Gruvbox, Solarized, Night Owl, Everforest, GitHub Dark and a High Contrast theme for low vision.
• My themes: design your own with three colours, save as many as you like, and add themes other people share.
• Backup: save all your settings, themes and site rules to a file and restore them anywhere.
• Fine-tune brightness, contrast and warmth, and dim bright photos for late-night reading.
• Choose how pages switch: Blink, Ripple, Fade, Curtain or Mist.

READING MODE
One click shows just the article, in your theme, with your choice of typeface, text size and column width. Menus, sidebars and comment sections are left out. Nothing is sent anywhere: the article is taken from the page you already have open.

WIND DOWN, LISTEN, SHARE
• Wind-down: from a bedtime you set, pages drift warmer and dimmer over an hour.
• Read aloud: reading mode and the PDF reader can read to you using your device's own voice.
• Share a theme: turn your look into a link that a friend can apply in one click.

STAY IN CONTROL
• Per-site rules: Auto, Always or Never, for a whole site or one section of it (Google Docs but not Sheets, for example). Each site can also have its own theme.
• Schedule: always on, follow your system's light and dark appearance, or set your own hours.
• "Only darken sites I pick" mode for people who want it on just a few sites.

DARK PDF READER
Open any PDF in ShutEye's own reader and it is drawn in your theme, with selectable text, search and your place remembered in each document. Photos inside the PDF keep their real colours.

ANNOTATE PDFS
Highlight, underline and strike through text, draw with a pen, pin notes and type on the page, in five colours. A side panel lists every annotation and the document outline. Save a copy of the PDF with your annotations drawn in, ready to share. Annotations are kept on your device.

PRIVATE BY DESIGN
ShutEye has no accounts, no analytics and no ads. Your settings stay on your device and nothing about your browsing is collected or sent anywhere.

The fox in the corner is the mascot. It sleeps while ShutEye is on and wakes up when you switch it off.

Also available for Safari on iPhone and iPad: https://advaithsajith.github.io/shuteye/
```

**Category**

```
Accessibility
```

(Second choice if you prefer: Productivity > Tools.)

**Language**

```
English
```

## Graphic assets

All of these are in the `store/` folder at the exact sizes the store requires.

| Asset | File | Size |
| --- | --- | --- |
| Store icon | `extension/images/icon-128.png` | 128 x 128 |
| Screenshot 1 | `store/screenshot-1-midnight.png` | 1280 x 800 |
| Screenshot 2 | `store/screenshot-2-dracula.png` | 1280 x 800 |
| Screenshot 3 | `store/screenshot-3-nord.png` | 1280 x 800 |
| Screenshot 4 | `store/screenshot-4-reader.png` | 1280 x 800 |
| Small promo tile | `store/promo-small-440x280.png` | 440 x 280 |
| Marquee promo tile (optional) | `store/promo-marquee-1400x560.png` | 1400 x 560 |

Screenshots 1 to 3 show a demonstration article, not a real website, with the
ShutEye panel placed over it. That avoids showing another site's content or
logo in your listing. If you would rather show real pages, take your own
1280 x 800 screenshots and swap them in.

## Additional fields

**Official URL / Homepage URL**

```
https://advaithsajith.github.io/shuteye/
```

**Support URL**

```
https://github.com/advaithsajith/shuteye/issues
```

## Privacy practices tab

**Single purpose description**

```
ShutEye has one purpose: to change the colours of the web pages and PDFs the user views so they are shown in a dark theme of the user's choice.
```

**Permission justifications**

`storage`

```
Saves the user's settings on their own device: chosen theme, brightness and schedule, per-site rules, and the reading position in PDFs. Nothing is sent off the device.
```

`activeTab`

```
Lets the toolbar popup read the address of the current tab when the user opens it, so it can show whether dark mode is on for that site and let the user add a rule for it.
```

**Host permission justification** (`<all_urls>`)

```
ShutEye's purpose is to darken any website the user visits, so its content script must be able to run on every site. The script only reads page colours and images in order to restyle them, and adds a style sheet. It does not collect or transmit page content. Host access is also used by the built-in PDF reader to download a PDF from a link the user chooses to open.
```

**Are you using remote code?**

```
No. All code is included in the package. No scripts are loaded from the network and nothing is evaluated at run time.
```

**Data usage** (tick boxes)

Tick **none** of the data categories. ShutEye does not collect personally
identifiable information, health, financial, authentication, personal
communications, location, web history, user activity or website content.

Then tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**

```
https://advaithsajith.github.io/shuteye/privacy/
```

## Distribution tab

- **Payments:** Free of charge
- **Visibility:** Public
- **Regions:** All regions

## What to expect from review

- Extensions that ask for access to all websites get a more detailed review.
  Expect it to take from a few days up to a few weeks.
- The most common reason for rejection is a description that does not match
  what the extension does, or a permission without a clear reason. The text
  above was written to match the code as it stands at version 1.4.0.
- If Google asks why ShutEye needs every site, the host permission
  justification above is the answer to send.

## Microsoft Edge Add-ons

Registration is free at https://partner.microsoft.com/dashboard/microsoftedge.
Upload the same zip, and reuse the name, summary, description, screenshots,
privacy policy URL and justifications above. Edge asks for a 300 x 300 logo:
use `extension/images/icon-512.png` and let the dashboard scale it.

## Not checked

This listing has not been submitted, so nothing here has been through Google's
review. The fee, field names and review times are as I understand them and may
have changed; the dashboard itself is the authority.
