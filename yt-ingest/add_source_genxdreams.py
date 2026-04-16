from google.cloud import firestore
db=firestore.Client()

sourceId="suno_genxdreams"
db.collection("sources").document(sourceId).set({
  "platform":"suno",
  "handle":"genxdreams",
  "accountLabel":"genxdreams_beta",
  "profileUrl":"https://suno.com/@genxdreams",
}, merge=True)

print("OK sources/", sourceId)
