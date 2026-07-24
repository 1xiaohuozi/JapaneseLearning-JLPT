# JapaneseLearning-JLPT

English | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

![Japanese learning mini program](assets/cover.png)

A WeChat Mini Program for JLPT-oriented Japanese study. The repository contains vocabulary, grammar, listening and shadowing exercises, study records, review statistics, user profiles, and a leaderboard.

## Screenshots

| Vocabulary study | Grammar study |
| --- | --- |
| ![Vocabulary study](assets/screenshot-01.png) | ![Grammar study](assets/screenshot-02.png) |

## Features

- Vocabulary study for JLPT N1, N2, N3, and N4/N5
- Grammar browsing, focused study sessions, and favorites
- Listening and shadowing practice with progress tracking
- Study plans, review statistics, and retention-related utilities
- User login, personal study dashboard, and leaderboard
- JLPT score estimation pages for N1–N5
- WeChat CloudBase database and cloud-function integration

## Tech Stack

- WeChat Mini Program
- JavaScript, WXML, and WXSS
- WeChat CloudBase
- Node.js cloud functions
- `wx-server-sdk`

## Project Structure

```text
.
├── assets/                 # README screenshots
├── cloudfunctions/         # Cloud functions
├── miniprogram/
│   ├── data/               # Local data manifests
│   ├── images/             # Mini Program UI assets
│   ├── pages/              # Application pages
│   └── utils/              # Study-plan and review utilities
├── project.config.json
└── uploadCloudFunction.bat
```

## Requirements

- WeChat Developer Tools
- A WeChat Mini Program AppID
- A WeChat CloudBase environment
- Node.js for installing cloud-function dependencies

## Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/1xiaohuozi/JapaneseLearning-JLPT.git
   cd JapaneseLearning-JLPT
   ```

2. Import the repository directory into WeChat Developer Tools.
3. Create or select a CloudBase environment.
4. Replace the existing environment ID in:

   - `miniprogram/app.js`
   - `miniprogram/envList.js`

5. Install dependencies and deploy the cloud functions under `cloudfunctions/`:

   - `getLeaderboard`
   - `getnumber`
   - `getOpenId`
   - `getUserOpenId`
   - `getUserReviewStats`
   - `lafService`

6. Create and populate the CloudBase collections referenced by the source code, and configure their access permissions.
7. Compile and preview the Mini Program in WeChat Developer Tools.

> `uploadCloudFunction.bat` contains machine-specific paths and environment values. Update it before using it on another computer.

## Usage

Open the Mini Program and choose one of the main tabs:

- **Vocabulary** for level-based word study
- **Grammar** for grammar browsing and focused review
- **Listening & Speaking** for listening and shadowing practice
- **Profile** for login, study progress, JLPT tools, and leaderboard access

Some study records and favorites require login because they are stored through CloudBase.

## Notes

- The application UI is currently Chinese.
- Cloud environment IDs and database content are deployment-specific.
- No standalone license file was found in the repository.
