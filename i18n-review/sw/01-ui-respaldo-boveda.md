# UI · Backup and vault

### `keyStore.dbKeyCorrupt`
- **EN:** The stored database encryption key is damaged or has an unexpected format. NIDO stopped here on purpose: NIDO will not overwrite it or open the database without it. If this keeps happening, reinstalling is the only recovery (existing local data cannot be decrypted without the original key).
- **SW (machine draft, please correct it):** Ufunguo wa usimbaji fiche wa hifadhidata uliohifadhiwa umeharibika au una muundo usiotarajiwa. NIDO imesimama hapa kwa makusudi: NIDO haitauandika upya wala kuifungua hifadhidata bila ufunguo huo. Ikiwa hii itaendelea kutokea, kusakinisha upya ndiyo njia pekee ya kurejesha (data iliyopo ya kifaa haiwezi kusimuliwa bila ufunguo asilia).
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyStore.dbKeyReadFailed`
- **EN:** NIDO could not read the database encryption key from the secure store. NIDO stopped here on purpose: no new key will be created, because that would permanently lock your existing encrypted data. Restart the app and try again.
- **SW (machine draft, please correct it):** NIDO haikuweza kusoma ufunguo wa usimbaji fiche wa hifadhidata kutoka kwenye hifadhi salama. NIDO imesimama hapa kwa makusudi: hakuna ufunguo mpya utakaoundwa, kwa sababu hiyo ingeifunga kabisa data yako iliyosimbwa iliyopo. Anzisha upya programu na ujaribu tena.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyStore.dbKeyWriteFailed`
- **EN:** NIDO generated a new database encryption key but could not save it to the secure store. NIDO stopped here on purpose: the unsaved key was discarded and will not be used. Restart the app and try again — if this keeps happening, the device's secure storage may be damaged.
- **SW (machine draft, please correct it):** NIDO ilitengeneza ufunguo mpya wa usimbaji fiche wa hifadhidata lakini haikuweza kuuhifadhi kwenye hifadhi salama. NIDO imesimama hapa kwa makusudi: ufunguo ambao haukuhifadhiwa ulitupwa na hautatumika. Anzisha upya programu na ujaribu tena — ikiwa hii itaendelea kutokea, hifadhi salama ya kifaa inaweza kuwa imeharibika.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyStore.dbKeyLost`
- **EN:** NIDO's database encryption key is missing from the secure store, but encrypted databases still exist on this device. NIDO stopped here on purpose: NIDO will NOT generate a new key silently — that would strand your existing data behind an unreadable database. Your data has NOT been deleted. To use NIDO again you must explicitly choose recovery (existing encrypted data cannot be decrypted without the original key).
- **SW (machine draft, please correct it):** Ufunguo wa usimbaji fiche wa hifadhidata wa NIDO umekosekana kwenye hifadhi salama, lakini hifadhidata zilizosimbwa bado zipo kwenye kifaa hiki. NIDO imesimama hapa kwa makusudi: NIDO HAITAunda ufunguo mpya kimya kimya — hiyo ingeacha data yako iliyopo nyuma ya hifadhidata isiyosomeka. Data yako HAIJAFUTWA. Ili kutumia NIDO tena lazima uchague urejeshaji kwa uwazi (data iliyosimbwa iliyopo haiwezi kusimuliwa bila ufunguo asilia).
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyStore.p2pKeyCorrupt`
- **EN:** This device's stored identity key is damaged or has an unexpected format. NIDO stopped here on purpose: NIDO will not replace it silently. Reset the identity to create a new one (you will need to re-pair your contacts).
- **SW (machine draft, please correct it):** Ufunguo wa utambulisho wa kifaa hiki uliohifadhiwa umeharibika au una muundo usiotarajiwa. NIDO imesimama hapa kwa makusudi: NIDO haitauandika upya kimya kimya. Weka upya utambulisho ili kuunda mpya (utahitaji kuoanisha upya anwani zako).
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyStore.p2pKeyReadFailed`
- **EN:** NIDO could not read this device's identity key from the secure store. NIDO stopped here on purpose: no new identity will be created, because that would silently break all your pairings. Restart the app and try again.
- **SW (machine draft, please correct it):** NIDO haikuweza kusoma ufunguo wa utambulisho wa kifaa hiki kutoka kwenye hifadhi salama. NIDO imesimama hapa kwa makusudi: hakuna utambulisho mpya utakaoundwa, kwa sababu hiyo ingevunja kimya kimya uoanishaji wako wote. Anzisha upya programu na ujaribu tena.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyStore.p2pSignKeyCorrupt`
- **EN:** This device's stored message-signing key is damaged or has an unexpected format. NIDO stopped here on purpose: NIDO will not replace it silently. Reset the identity to create a new one.
- **SW (machine draft, please correct it):** Ufunguo wa kutia saini ujumbe wa kifaa hiki uliohifadhiwa umeharibika au una muundo usiotarajiwa. NIDO imesimama hapa kwa makusudi: NIDO haitauandika upya kimya kimya. Weka upya utambulisho ili kuunda mpya.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyStore.p2pSignKeyReadFailed`
- **EN:** NIDO could not read this device's message-signing key from the secure store. NIDO stopped here on purpose: no new signing key will be created. Restart the app and try again.
- **SW (machine draft, please correct it):** NIDO haikuweza kusoma ufunguo wa kutia saini ujumbe wa kifaa hiki kutoka kwenye hifadhi salama. NIDO imesimama hapa kwa makusudi: hakuna ufunguo mpya wa kutia saini utakaoundwa. Anzisha upya programu na ujaribu tena.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyRecovery.title`
- **EN:** Encryption key lost
- **SW (machine draft, please correct it):** Ufunguo wa usimbaji fiche umepotea
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyRecovery.whatHappened`
- **EN:** NIDO's database encryption key is missing from this device's secure storage, but encrypted databases were found on the device. NIDO stopped here on purpose: creating a new key silently would lock your existing data behind a database it can never open again.
- **SW (machine draft, please correct it):** Ufunguo wa usimbaji fiche wa hifadhidata wa NIDO umekosekana kwenye hifadhi salama ya kifaa hiki, lakini hifadhidata zilizosimbwa zilipatikana kwenye kifaa. NIDO imesimama hapa kwa makusudi: kuunda ufunguo mpya kimya kimya kungeifunga data yako iliyopo nyuma ya hifadhidata ambayo haitawahi kuifungua tena.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyRecovery.databasesFound`
- **EN:** Encrypted databases found — untouched:
- **SW (machine draft, please correct it):** Hifadhidata zilizosimbwa zilizopatikana — hazijaguswa:
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyRecovery.notDeleted`
- **EN:** Your data has NOT been deleted. The encrypted databases are still on this device, exactly as they were.
- **SW (machine draft, please correct it):** Data yako HAIJAFUTWA. Hifadhidata zilizosimbwa bado ziko kwenye kifaa hiki, kama zilivyokuwa kabisa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyRecovery.cannotRecoverKey`
- **EN:** NIDO cannot recover the missing key, and nothing you do here will bring it back. Without the original key, the existing encrypted data cannot be decrypted — by you or by NIDO.
- **SW (machine draft, please correct it):** NIDO haiwezi kuurejesha ufunguo uliopotea, na hakuna chochote utakachofanya hapa kitakachourejesha. Bila ufunguo asilia, data iliyopo iliyosimbwa haiwezi kusimuliwa — si na wewe, si na NIDO.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyRecovery.startRecovery`
- **EN:** I understand — start recovery
- **SW (machine draft, please correct it):** Naelewa — anza urejeshaji
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyRecovery.checkAgain`
- **EN:** Check again
- **SW (machine draft, please correct it):** Angalia tena
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyRecovery.confirmTitle`
- **EN:** Archive databases and start fresh?
- **SW (machine draft, please correct it):** Weka hifadhidata kwenye kumbukumbu na uanze upya?
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyRecovery.confirmBody`
- **EN:** Recovery keeps the unreadable encrypted databases as archives (in case the original key ever reappears) and lets NIDO start as a new installation with a new key. The archived data cannot be read without the original key. This is the only way to use NIDO again.
- **SW (machine draft, please correct it):** Urejeshaji huweka hifadhidata zilizosimbwa zisizosomwa kama kumbukumbu (iwapo ufunguo asilia utapatikana tena siku moja) na huiruhusu NIDO kuanza kama usakinishaji mpya wenye ufunguo mpya. Data iliyohifadhiwa kama kumbukumbu haiwezi kusomwa bila ufunguo asilia. Hii ndiyo njia pekee ya kutumia NIDO tena.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyRecovery.confirmButton`
- **EN:** Yes — archive and start fresh
- **SW (machine draft, please correct it):** Ndiyo — weka kwenye kumbukumbu na uanze upya
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyRecovery.cancel`
- **EN:** Cancel
- **SW (machine draft, please correct it):** Ghairi
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyRecovery.recovering`
- **EN:** Archiving databases…
- **SW (machine draft, please correct it):** Inaweka hifadhidata kwenye kumbukumbu…
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `keyRecovery.recoveryFailed`
- **EN:** Recovery could not be completed safely. Nothing else was touched. You can try again.
- **SW (machine draft, please correct it):** Urejeshaji haukuweza kukamilishwa kwa usalama. Hakuna kingine kilichoguswa. Unaweza kujaribu tena.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.dekTitle`
- **EN:** Backup created
- **SW (machine draft, please correct it):** Nakala rudufu imeundwa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.dekSavedIn`
- **EN:** Saved to:
- **SW (machine draft, please correct it):** Imehifadhiwa kwenye:
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.dekCopyPrompt`
- **EN:** YOUR KEY (copy it and store it separately from the backup):
- **SW (machine draft, please correct it):** UFUNGUO WAKO (unakili na uuhifadhi tofauti na nakala rudufu):
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.dekWarning`
- **EN:** Without this key the backup is useless.
- **SW (machine draft, please correct it):** Bila ufunguo huu nakala rudufu haina maana.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.copyKey`
- **EN:** Copy key
- **SW (machine draft, please correct it):** Nakili ufunguo
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.keyCopiedNote`
- **EN:** Key copied. It will be cleared from the clipboard in 60 seconds.
- **SW (machine draft, please correct it):** Ufunguo umenakiliwa. Utafutwa kwenye ubao wa kunakili baada ya sekunde 60.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.understood`
- **EN:** Got it
- **SW (machine draft, please correct it):** Nimeelewa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.dekFraudWarning`
- **EN:** NIDO will never ask for this key. Don't share it with anyone, not even supposed tech support.
- **SW (machine draft, please correct it):** NIDO haitawahi kukuomba ufunguo huu. Usimshirikishe mtu yeyote, hata anayejiita msaada wa kiufundi.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.createButton`
- **EN:** Create backup
- **SW (machine draft, please correct it):** Unda nakala rudufu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.shareButton`
- **EN:** Share backup
- **SW (machine draft, please correct it):** Shirikisha nakala rudufu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.restoreButton`
- **EN:** Restore backup
- **SW (machine draft, please correct it):** Rejesha nakala rudufu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.errorTitle`
- **EN:** Error
- **SW (machine draft, please correct it):** Hitilafu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.shareFailed`
- **EN:** Could not share the backup.
- **SW (machine draft, please correct it):** Haikuweza kushirikisha nakala rudufu.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.sharingUnavailable`
- **EN:** Your device does not allow sharing files.
- **SW (machine draft, please correct it):** Kifaa chako hakiruhusu kushirikisha faili.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.noBackupsTitle`
- **EN:** No backups
- **SW (machine draft, please correct it):** Hakuna nakala rudufu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.noBackupsBody`
- **EN:** You haven't created any backup yet.
- **SW (machine draft, please correct it):** Bado hujaunda nakala rudufu yoyote.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.createFailed`
- **EN:** Could not create the backup.
- **SW (machine draft, please correct it):** Haikuweza kuunda nakala rudufu.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.invalidTitle`
- **EN:** Invalid backup
- **SW (machine draft, please correct it):** Nakala rudufu isiyo sahihi
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.invalidBody`
- **EN:** The file is not a valid backup.
- **SW (machine draft, please correct it):** Faili si nakala rudufu sahihi.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.restoreTitle`
- **EN:** Restore backup
- **SW (machine draft, please correct it):** Rejesha nakala rudufu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.restoreConfirm`
- **EN:** This will replace your current chats, notes, documents and knowledge with the backup's. Anything you deleted after making it (chats, notes, documents, contacts you removed) will come back. Contacts you revoked stay revoked. What does not travel in a backup: your settings or the tools you turned off (they stay as this phone has them), your NIDO-to-NIDO identity (it never leaves the phone, by design: on a new phone you pair again) and downloaded packs (they download again). Continue?
- **SW (machine draft, please correct it):** Hii itaweka badala ya mazungumzo yako ya sasa, noti, nyaraka na maarifa, yale yaliyo kwenye nakala rudufu. Chochote ulichokifuta baada ya kuunda nakala hiyo (mazungumzo, noti, nyaraka, anwani ulizoondoa) kitarudi. Anwani ulizozikataa hubaki zimekataliwa. Visivyosafiri kwenye nakala rudufu: mipangilio yako au zana ulizozima (hubaki kama simu hii ilivyo nazo), utambulisho wako wa NIDO-kwa-NIDO (hauondoki kamwe kwenye simu, kwa makusudi: kwenye simu mpya unaoanisha tena) na pakiti zilizopakuliwa (hupakuliwa tena). Endelea?
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.restoreConfirmDated`
- **EN:** This backup is from {{date}}{{made}}. It will replace your current chats, notes, documents and knowledge with that day's: anything you deleted since then (chats, notes, documents, contacts you removed) will come back. Contacts you revoked stay revoked. What does not travel in a backup: your settings or the tools you turned off (they stay as this phone has them), your NIDO-to-NIDO identity (it never leaves the phone, by design: on a new phone you pair again) and downloaded packs (they download again). Continue?
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Nakala rudufu hii ni ya {{date}}{{made}}. Itaweka badala ya mazungumzo yako ya sasa, noti, nyaraka na maarifa, yale ya siku hiyo: chochote ulichokifuta tangu wakati huo (mazungumzo, noti, nyaraka, anwani ulizoondoa) kitarudi. Anwani ulizozikataa hubaki zimekataliwa. Visivyosafiri kwenye nakala rudufu: mipangilio yako au zana ulizozima (hubaki kama simu hii ilivyo nazo), utambulisho wako wa NIDO-kwa-NIDO (hauondoki kamwe kwenye simu, kwa makusudi: kwenye simu mpya unaoanisha tena) na pakiti zilizopakuliwa (hupakuliwa tena). Endelea?
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.restoreMadeWith`
- **EN:**  (NIDO {{version}})
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):**  (NIDO {{version}})
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.restoreConfirmButton`
- **EN:** Restore
- **SW (machine draft, please correct it):** Rejesha
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.restoreDoneTitle`
- **EN:** Restored
- **SW (machine draft, please correct it):** Imerejeshwa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.restoreDoneBody`
- **EN:** Backup restored. Restart the app to use the restored data.
- **SW (machine draft, please correct it):** Nakala rudufu imerejeshwa. Anzisha upya programu ili kutumia data iliyorejeshwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.restoreFailed`
- **EN:** Could not restore.
- **SW (machine draft, please correct it):** Haikuweza kurejesha.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.pickerFailed`
- **EN:** Could not open the picker.
- **SW (machine draft, please correct it):** Haikuweza kufungua kichaguzi.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.cancel`
- **EN:** Cancel
- **SW (machine draft, please correct it):** Ghairi
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.ok`
- **EN:** OK
- **SW (machine draft, please correct it):** Sawa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.sectionDesc`
- **EN:** Export your encrypted database. Store it with your key in a safe place.
- **SW (machine draft, please correct it):** Hamisha hifadhidata yako iliyosimbwa. Ihifadhi pamoja na ufunguo wako mahali salama.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.screenTitle`
- **EN:** Backup and recovery
- **SW (machine draft, please correct it):** Nakala rudufu na urejeshaji
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.screenDesc`
- **EN:** Your database is encrypted. The backup copies the encrypted file. You need to save your key separately — without it, the backup cannot be restored. No server ever sees your data.
- **SW (machine draft, please correct it):** Hifadhidata yako imesimbwa. Nakala rudufu hunakili faili iliyosimbwa. Unahitaji kuhifadhi ufunguo wako tofauti — bila ufunguo huo, nakala rudufu haiwezi kurejeshwa. Hakuna seva inayoona data yako kamwe.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.rotateErrors.authCancelled`
- **EN:** Authentication cancelled.
- **SW (machine draft, please correct it):** Uthibitishaji umeghairiwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.rotateErrors.authFailed`
- **EN:** Couldn't verify your identity.
- **SW (machine draft, please correct it):** Haikuweza kuthibitisha utambulisho wako.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.rotateErrors.noKey`
- **EN:** There's no active encryption key on this phone.
- **SW (machine draft, please correct it):** Hakuna ufunguo wa usimbaji fiche unaotumika kwenye simu hii.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.rotateErrors.noDatabases`
- **EN:** The databases weren't found.
- **SW (machine draft, please correct it):** Hifadhidata hazikupatikana.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.rotateErrors.staging`
- **EN:** Couldn't prepare the key change. Nothing was changed.
- **SW (machine draft, please correct it):** Haikuweza kuandaa ubadilishaji wa ufunguo. Hakuna kilichobadilishwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.rotateErrors.storeFailed`
- **EN:** Couldn't save the new key; the previous one was kept.
- **SW (machine draft, please correct it):** Haikuweza kuhifadhi ufunguo mpya; ule wa awali ulibaki.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.keyNeedsLockTitle`
- **EN:** A screen lock is needed to show your key
- **SW (machine draft, please correct it):** Kufuli ya skrini inahitajika ili kuonyesha ufunguo wako
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.keyNeedsLockBody`
- **EN:** Your phone has no PIN, pattern or fingerprint set, so anyone holding it could read the key. Set a screen lock in Android settings, then come back here to see it. Creating backups keeps working as always. Only the key stays hidden.
- **SW (machine draft, please correct it):** Simu yako haina PIN, mchoro wala alama ya kidole iliyowekwa, kwa hiyo mtu yeyote anayeishika anaweza kuusoma ufunguo. Weka kufuli ya skrini kwenye mipangilio ya Android, kisha urudi hapa kuuona. Kuunda nakala rudufu kunaendelea kufanya kazi kama kawaida. Ufunguo tu ndio unaobaki umefichwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.errors.storage`
- **EN:** Couldn't access the phone's storage.
- **SW (machine draft, please correct it):** Haikuweza kufikia hifadhi ya simu.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.errors.dbMissing`
- **EN:** The database wasn't found.
- **SW (machine draft, please correct it):** Hifadhidata haikupatikana.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.errors.noDbKey`
- **EN:** Couldn't get the database key.
- **SW (machine draft, please correct it):** Haikuweza kupata ufunguo wa hifadhidata.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.errors.invalid`
- **EN:** The file isn't a valid backup.
- **SW (machine draft, please correct it):** Faili si nakala rudufu sahihi.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.errors.rollback`
- **EN:** Couldn't restore; your previous data was left as it was.
- **SW (machine draft, please correct it):** Haikuweza kurejesha; data yako ya awali iliachwa kama ilivyokuwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.errors.keyFormat`
- **EN:** The backup key must be 64 hexadecimal characters.
- **SW (machine draft, please correct it):** Ufunguo wa nakala rudufu lazima uwe herufi 64 za heksadesimali.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.errors.noDeviceKey`
- **EN:** This phone has no encryption key available. Use “Restore with the backup's key”.
- **SW (machine draft, please correct it):** Simu hii haina ufunguo wa usimbaji fiche unaopatikana. Tumia “Rejesha kwa ufunguo wa nakala rudufu”.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.errors.wrongKey`
- **EN:** The key doesn't open this backup. Check that it's the key you saved when you created it.
- **SW (machine draft, please correct it):** Ufunguo huo hauifungui nakala rudufu hii. Hakikisha ni ufunguo uliouhifadhi ulipounda nakala hiyo.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.errors.authCancelled`
- **EN:** Authentication cancelled.
- **SW (machine draft, please correct it):** Uthibitishaji umeghairiwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.createNow`
- **EN:** Create backup now
- **SW (machine draft, please correct it):** Unda nakala rudufu sasa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.showKey`
- **EN:** View my encryption key
- **SW (machine draft, please correct it):** Tazama ufunguo wangu wa usimbaji fiche
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.rotateKey`
- **EN:** Rotate encryption key
- **SW (machine draft, please correct it):** Badilisha ufunguo wa usimbaji fiche
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.saveToDownloads`
- **EN:** Save to Downloads
- **SW (machine draft, please correct it):** Hifadhi kwenye Vipakuliwa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.close`
- **EN:** Close
- **SW (machine draft, please correct it):** Funga
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.lastBackup`
- **EN:** Last backup: {{path}}
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Nakala rudufu ya mwisho: {{path}}
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.warning`
- **EN:** Important: store the backup file and your key in different places. If you lose the key, nobody (not even NIDO) can recover your data.
- **SW (machine draft, please correct it):** Muhimu: hifadhi faili ya nakala rudufu na ufunguo wako mahali tofauti. Ukipoteza ufunguo, hakuna mtu (hata NIDO) anayeweza kurejesha data yako.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.unlockReason`
- **EN:** View your encryption key
- **SW (machine draft, please correct it):** Tazama ufunguo wako wa usimbaji fiche
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.cancelledTitle`
- **EN:** Cancelled
- **SW (machine draft, please correct it):** Imeghairiwa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.keyNotShown`
- **EN:** The key was not shown.
- **SW (machine draft, please correct it):** Ufunguo haukuonyeshwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.rotateTitle`
- **EN:** Rotate encryption key
- **SW (machine draft, please correct it):** Badilisha ufunguo wa usimbaji fiche
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.rotateBody`
- **EN:** This creates a new key and re-encrypts your database. Earlier backups can NOT be restored with the new key. Continue?
- **SW (machine draft, please correct it):** Hii huunda ufunguo mpya na kusimba upya hifadhidata yako. Nakala rudufu za awali HAZIWEZI kurejeshwa kwa ufunguo mpya. Endelea?
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.rotateConfirm`
- **EN:** Rotate
- **SW (machine draft, please correct it):** Badilisha
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.rotatedTitle`
- **EN:** Key rotated
- **SW (machine draft, please correct it):** Ufunguo umebadilishwa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.rotatedBody`
- **EN:** Your database now uses a new encryption key. Save the new key from “View my encryption key”. Older backups will need the previous key.
- **SW (machine draft, please correct it):** Hifadhidata yako sasa inatumia ufunguo mpya wa usimbaji fiche. Hifadhi ufunguo mpya kutoka “Tazama ufunguo wangu wa usimbaji fiche”. Nakala rudufu za zamani zitahitaji ufunguo wa awali.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.rotateFailed`
- **EN:** The key could not be rotated.
- **SW (machine draft, please correct it):** Ufunguo haukuweza kubadilishwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.createFirst`
- **EN:** Create a backup first with the button above.
- **SW (machine draft, please correct it):** Unda nakala rudufu kwanza kwa kitufe kilicho juu.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.noPermission`
- **EN:** Without permission the backup cannot be saved.
- **SW (machine draft, please correct it):** Bila ruhusa nakala rudufu haiwezi kuhifadhiwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.savedTitle`
- **EN:** Saved
- **SW (machine draft, please correct it):** Imehifadhiwa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.savedBody`
- **EN:** Backup copied to the folder you chose:
{{files}}
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Nakala rudufu imenakiliwa kwenye folda uliyochagua:
{{files}}
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.saveFailed`
- **EN:** The backup could not be saved.
- **SW (machine draft, please correct it):** Nakala rudufu haikuweza kuhifadhiwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.keyFailed`
- **EN:** The key could not be read.
- **SW (machine draft, please correct it):** Ufunguo haukuweza kusomwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.keyTitle`
- **EN:** Your encryption key
- **SW (machine draft, please correct it):** Ufunguo wako wa usimbaji fiche
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.restoreWithKeyButton`
- **EN:** Restore with the backup's key
- **SW (machine draft, please correct it):** Rejesha kwa ufunguo wa nakala rudufu
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.restoreWithKeyTitle`
- **EN:** Restore a backup from another phone
- **SW (machine draft, please correct it):** Rejesha nakala rudufu kutoka simu nyingine
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.restoreWithKeyBody`
- **EN:** Use this when the backup was made on another phone, on an earlier install, or before you rotated your key. Paste the key you saved when you created that backup, then choose the file. This replaces your current chats, notes, documents and knowledge; settings, your NIDO-to-NIDO identity and downloaded packs do not travel in a backup.
- **SW (machine draft, please correct it):** Tumia hii wakati nakala rudufu ilipoundwa kwenye simu nyingine, kwenye usakinishaji wa awali, au kabla hujabadilisha ufunguo wako. Bandika ufunguo uliouhifadhi ulipounda nakala hiyo, kisha uchague faili. Hii huweka badala ya mazungumzo yako ya sasa, noti, nyaraka na maarifa; mipangilio, utambulisho wako wa NIDO-kwa-NIDO na pakiti zilizopakuliwa havisafiri kwenye nakala rudufu.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.keyPlaceholder`
- **EN:** Backup key (64 characters)
- **SW (machine draft, please correct it):** Ufunguo wa nakala rudufu (herufi 64)
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.keyInvalid`
- **EN:** The key must be 64 characters, using only 0–9 and a–f.
- **SW (machine draft, please correct it):** Ufunguo lazima uwe herufi 64, ukitumia 0–9 na a–f tu.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `backup.chooseFile`
- **EN:** Choose file
- **SW (machine draft, please correct it):** Chagua faili
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.offerTitle`
- **EN:** Protect your data with your fingerprint or PIN
- **SW (machine draft, please correct it):** Linda data yako kwa alama ya kidole au PIN yako
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.offerBody`
- **EN:** Turn on hardware protection: the key to your data stays in the tablet's security chip and only opens with your PIN, pattern or fingerprint. It is NIDO's strongest protection.
- **SW (machine draft, please correct it):** Washa ulinzi wa kifaa: ufunguo wa data yako hubaki kwenye chipu ya usalama ya tableti na hufunguka tu kwa PIN, mchoro au alama yako ya kidole. Ni ulinzi imara zaidi wa NIDO.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.offerActivate`
- **EN:** Turn on
- **SW (machine draft, please correct it):** Washa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.offerLater`
- **EN:** Not now
- **SW (machine draft, please correct it):** Si sasa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.offerNever`
- **EN:** Don't ask again
- **SW (machine draft, please correct it):** Usiniulize tena
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.offerConfirmHint`
- **EN:** Before you confirm: if you ever remove the screen lock, NIDO cannot open your data without a backup and its key. That is why a backup from the last 30 days, saved to a folder outside the app with its key saved, is required before turning it on (About → Open backup).
- **SW (machine draft, please correct it):** Kabla ya kuthibitisha: ukiwahi kuondoa kufuli ya skrini, NIDO haiwezi kufungua data yako bila nakala rudufu na ufunguo wake. Ndiyo sababu nakala rudufu ya siku 30 zilizopita, iliyohifadhiwa kwenye folda nje ya programu na ufunguo wake umehifadhiwa, inahitajika kabla ya kuwasha (Kuhusu → Fungua nakala rudufu).
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.offerConfirm`
- **EN:** Confirm and turn on
- **SW (machine draft, please correct it):** Thibitisha na uwasha
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.title`
- **EN:** Hardware protection
- **SW (machine draft, please correct it):** Ulinzi wa kifaa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.body`
- **EN:** Protects NIDO's data with the tablet's security chip: it only opens with your PIN, pattern or fingerprint. If someone takes the tablet powered off or rebooted, they can't read your NIDO data even if they extract it.
- **SW (machine draft, please correct it):** Hulinda data ya NIDO kwa chipu ya usalama ya tableti: hufunguka tu kwa PIN, mchoro au alama yako ya kidole. Mtu akiichukua tableti ikiwa imezimwa au imeanzishwa upya, hawezi kusoma data yako ya NIDO hata akiitoa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.statusActive`
- **EN:** On · key in {{level}}
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Imewashwa · ufunguo uko katika {{level}}
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.statusInactive`
- **EN:** Off
- **SW (machine draft, please correct it):** Imezimwa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.activate`
- **EN:** Turn on protection
- **SW (machine draft, please correct it):** Washa ulinzi
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.deactivate`
- **EN:** Turn off
- **SW (machine draft, please correct it):** Zima
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.levelSoftware`
- **EN:** software (no secure chip)
- **SW (machine draft, please correct it):** programu (hakuna chipu salama)
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.promptTitle`
- **EN:** Protect your NIDO data
- **SW (machine draft, please correct it):** Linda data yako ya NIDO
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.promptSubtitle`
- **EN:** Confirm with your PIN or fingerprint
- **SW (machine draft, please correct it):** Thibitisha kwa PIN au alama yako ya kidole
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.confirmTitle`
- **EN:** Turn on hardware protection?
- **SW (machine draft, please correct it):** Washa ulinzi wa kifaa?
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.confirmBody`
- **EN:** Your NIDO data will only open with this tablet's PIN, pattern or fingerprint.

Important: if you ever REMOVE the tablet's screen lock, Android deletes this key and NIDO won't be able to open your data; you can only recover it from a backup and its key.

That is why a backup from the last 30 days, saved to a folder outside the app with its key saved, is required (About → Open backup).
- **SW (machine draft, please correct it):** Data yako ya NIDO itafunguka tu kwa PIN, mchoro au alama ya kidole ya tableti hii.

Muhimu: ukiwahi KUONDOA kufuli ya skrini ya tableti, Android huufuta ufunguo huu na NIDO haitaweza kufungua data yako; unaweza kuirejesha tu kutoka kwenye nakala rudufu na ufunguo wake.

Ndiyo sababu nakala rudufu ya siku 30 zilizopita, iliyohifadhiwa kwenye folda nje ya programu na ufunguo wake umehifadhiwa, inahitajika (Kuhusu → Fungua nakala rudufu).
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.confirmActivate`
- **EN:** Turn on
- **SW (machine draft, please correct it):** Washa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.activated`
- **EN:** Protection turned on.
- **SW (machine draft, please correct it):** Ulinzi umewashwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.deactivateTitle`
- **EN:** Turn off hardware protection?
- **SW (machine draft, please correct it):** Zima ulinzi wa kifaa?
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.deactivateBody`
- **EN:** Your data's key will be stored again without requiring your PIN or fingerprint.
- **SW (machine draft, please correct it):** Ufunguo wa data yako utahifadhiwa tena bila kuhitaji PIN au alama yako ya kidole.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.deactivated`
- **EN:** Protection turned off.
- **SW (machine draft, please correct it):** Ulinzi umezimwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.errNoLock`
- **EN:** Set a PIN, pattern or password on the tablet to turn on hardware protection.
- **SW (machine draft, please correct it):** Weka PIN, mchoro au nenosiri kwenye tableti ili kuwasha ulinzi wa kifaa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.errNeedBackup`
- **EN:** First create a backup and save it to a folder (About → Open backup), and keep its key somewhere safe. Without a backup saved outside the app in the last 30 days, hardware protection won’t turn on: if you ever removed the screen lock, you would lose your data.
- **SW (machine draft, please correct it):** Kwanza unda nakala rudufu na uihifadhi kwenye folda (Kuhusu → Fungua nakala rudufu), na uuweke ufunguo wake mahali salama. Bila nakala rudufu iliyohifadhiwa nje ya programu katika siku 30 zilizopita, ulinzi wa kifaa hautawashwa: ukiwahi kuondoa kufuli ya skrini, ungepoteza data yako.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.errUnavailable`
- **EN:** Hardware protection isn't available in this build of NIDO.
- **SW (machine draft, please correct it):** Ulinzi wa kifaa haupatikani katika toleo hili la NIDO.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.errStatus`
- **EN:** Couldn't check hardware protection on this device: {{reason}}
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** Haikuweza kuangalia ulinzi wa kifaa kwenye kifaa hiki: {{reason}}
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.errVerify`
- **EN:** Verification failed and nothing was changed. Your data is unchanged.
- **SW (machine draft, please correct it):** Uthibitishaji umeshindwa na hakuna kilichobadilishwa. Data yako haijabadilika.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.errGeneric`
- **EN:** Couldn't complete it. Nothing was changed.
- **SW (machine draft, please correct it):** Haikuweza kukamilisha. Hakuna kilichobadilishwa.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.lockSubtitle`
- **EN:** Your data is protected by the security chip. Unlock with your PIN, pattern or fingerprint.
- **SW (machine draft, please correct it):** Data yako imelindwa na chipu ya usalama. Fungua kwa PIN, mchoro au alama yako ya kidole.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.keyInvalidated`
- **EN:** Android invalidated NIDO's security key (usually because the screen lock was removed). Your data can't be opened without a backup.
- **SW (machine draft, please correct it):** Android imeubatilisha ufunguo wa usalama wa NIDO (kwa kawaida kwa sababu kufuli ya skrini iliondolewa). Data yako haiwezi kufunguliwa bila nakala rudufu.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.promptVerify`
- **EN:** Confirm once more to verify the protection
- **SW (machine draft, please correct it):** Thibitisha mara moja zaidi ili kuhakiki ulinzi
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.errUnsupported`
- **EN:** Hardware protection requires Android 11 or later.
- **SW (machine draft, please correct it):** Ulinzi wa kifaa unahitaji Android 11 au mpya zaidi.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.rewrapProtect`
- **EN:** Confirm to protect the new key
- **SW (machine draft, please correct it):** Thibitisha ili kulinda ufunguo mpya
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.rewrapVerify`
- **EN:** Confirm once more to verify it
- **SW (machine draft, please correct it):** Thibitisha mara moja zaidi ili kuhakiki
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.strictTitle`
- **EN:** Maximum security mode
- **SW (machine draft, please correct it):** Hali ya usalama wa juu zaidi
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.strictBody`
- **EN:** If you leave NIDO (or turn the screen off) for longer than the chosen time, NIDO closes completely and wipes the key and your data from memory. So even if the tablet is stolen while on, there's nothing left to extract. While closed you won't receive P2P messages: your contacts keep them and they arrive when you open NIDO again.
- **SW (machine draft, please correct it):** Ukiiacha NIDO (au ukizima skrini) kwa muda unaozidi ule uliouchagua, NIDO hujifunga kabisa na kuufuta ufunguo na data yako kwenye kumbukumbu. Hivyo hata tableti ikiibwa ikiwa imewashwa, hakuna kilichosalia cha kuchukua. Ikiwa imefungwa hutapokea ujumbe wa P2P: anwani zako huuhifadhi ujumbe huo na hukuja unapoifungua NIDO tena.
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.strictOff`
- **EN:** Off
- **SW (machine draft, please correct it):** Imezimwa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.strictSeconds`
- **EN:** {{n}} s
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** {{n}} s
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.strictMinutes`
- **EN:** {{n}} min
> ⚠ Do not translate or move what is inside {{ }}.
- **SW (machine draft, please correct it):** {{n}} min
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.strictEnable`
- **EN:** Turn on
- **SW (machine draft, please correct it):** Washa
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

### `vault.strictConfirm`
- **EN:** NIDO will close completely when you leave the app for longer than the chosen time, and you'll need to unlock it again. While closed you won't receive P2P messages (they arrive when you open it).
- **SW (machine draft, please correct it):** NIDO itajifunga kabisa ukiiacha programu kwa muda unaozidi ule uliouchagua, na utahitaji kuifungua tena. Ikiwa imefungwa hutapokea ujumbe wa P2P (huja unapoifungua).
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*
