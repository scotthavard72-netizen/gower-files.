# Gower Files

Scott's college and home file store. The app is a static page served by GitHub Pages; sign-in, the file list and the files themselves live in the `gower-files` Firebase project, locked to one Google account by `firestore.rules` and `storage.rules`.

Apply rules and storage settings from Google Cloud Shell:

```
git clone https://github.com/scotthavard72-netizen/gower-files. gf && cd gf
firebase deploy --only firestore:rules,storage --project gower-files
gcloud storage buckets update gs://gower-files.firebasestorage.app --cors-file=cors.json
```
