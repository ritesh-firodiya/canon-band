---
updated: 2026-11-06
horizon: 2026-11-18
---

# Tasks

## Now

1. [ ] T010 After a week of use, compare with the baseline; set each feature's `outcome` and remove what did not help  `plan:0001`
2. [ ] T011 On 2026-11-18, run `canon learn --cost` and judge weigh against the revisit in IDEA-0007  `idea:0007`

## Next

From the first real run (canon T054: askcal BUG-0008 on a hotfix pipeline, 2026-11-13; 3 agent stages, 0 failed, $2.18, about 7 minutes).

- [ ] T012 Ship a `hotfix` pipeline beside `default` (intake, code, review gate, release by person). The site and designs show one; none existed, so it was hand-written in askcal's context.yaml.
- [ ] T013 `canon run` commits the record's own update after the last agent stage; the review stage's notes were left uncommitted.
- [ ] T014 Set the record's closed status when every stage is done; BUG-0008 stayed `open` after "went through every stage".
- [ ] T015 The "waiting for a person" line says to run `canon approve` in your own terminal; a `!` command in a session is refused as an agent.
