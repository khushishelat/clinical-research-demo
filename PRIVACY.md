# Clinicians on Trial Check

Trial Check shows which clinicians run trials in a disease. It holds
professional facts from public sources, and nothing else.

## What a profile shows

- **Name and trial roles** from ClinicalTrials.gov: the trials where the
  registry names the person as an overall official (principal investigator or
  study chair) or a site principal investigator.
- **Specialty and practice city** from the NPI Registry. Profiles exist only for
  US clinicians matched to an NPI record. Everyone else appears by name on their
  trials, with no profile.
- **Paper counts and recent titles** from PubMed, kept only when an affiliation
  confirms the author is the same person.
- **Roles named in public sources**, such as presenting a trial's data at a
  conference, each with its source link.

## What it never holds

Phone numbers, email addresses, street addresses, site contacts, or any rating
or opinion of a clinician. The pipeline strips street addresses from
affiliations and contact details from quoted sources, and it refuses to save a
file if any remain.

## Asking to be removed

Every profile has an "Ask to have this profile removed" link. On a deployment it
goes to whoever runs that deployment (`NEXT_PUBLIC_REMOVAL_URL`). In this
repository, open an issue with the name only; no other details are needed.

To remove someone, run:

```bash
npm run remove-clinician -- "First Last" --yes
```

This deletes them from every built disease right away and adds a hash of their
record to `scripts/removed.json`, so later builds skip them. The file holds
hashes, not names, so the list of people who asked is not itself public.
