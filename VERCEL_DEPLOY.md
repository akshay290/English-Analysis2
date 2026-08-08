# Deploy the SSC English Mock Analyzer on Vercel

This app is a static Vite site. It stores mock attempts in the browser, so it does not need a database, API keys, or environment variables.

## Import from GitHub

1. Push this repository to GitHub.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Leave the detected framework as **Vite** and keep the project root at the repository root.
4. Keep the default build settings. The repository includes a root `vercel.json` with the workspace build and output directory.
5. Click **Deploy**.

Every new push to the selected GitHub branch will create a fresh deployment.

## Use the app

- Use **Import** to load a JSON export from this analyzer or a CSV with the headers shown in the import dialog.
- Use **Add mock** to record an attempt manually.
- Use **Export** to back up the current browser data as JSON before clearing browser storage or changing devices.

Because data is kept locally, each browser/device has its own study history. Export and import are the portable backup path.