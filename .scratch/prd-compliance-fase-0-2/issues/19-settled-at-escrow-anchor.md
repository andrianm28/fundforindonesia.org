# 19: Provider settlement time anchors the Escrow Hold

**What to build:** The hold on a Donation counts from when the provider actually settled it, not from when our server happened to receive a webhook.

**Blocked by:** 18

**Status:** ready-for-agent

- [ ] A settlement timestamp is stored on the Payment, read from the provider payload
- [ ] Escrow release is computed from provider settlement, not server receipt time
- [ ] The frozen hold duration on the Payment continues to govern, so changing the default cannot move an existing Payment's release
- [ ] Matches the Sumopod integration notes, which already require this
