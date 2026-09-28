# 03: Where do submitted documents live, and who may see one?

**Type:** grilling

**Status:** resolved

**Blocked by:** 01

## Question

§7.1 lists eleven required documents per Kind. A Verifier ticks a label —
there is no document behind any of them. So FFI-04, FFI-05 and FFI-08b all
rest on assurance with nothing in it, and the thing that makes verification
mean something is missing.

The one upload endpoint that exists is a trap rather than a starting point:
it accepts `image/jpeg|png|webp` only, writes into `public/uploads`, and
serves from there with no access control. Used for a KTP or an deed of
foundation, every identity document the platform ever holds is a public URL.
This is the finding whose damage arrives last and does not undo.

Questions:

1. **What is a document, and where does it live?** Object storage with signed
   URLs, or the database, or the host's disk. This decides whether a link
   expires, whether the platform can serve one at all, and what it costs to
   delete one.

2. **Who may see one?** A Verifier checking a Fundraiser's identity document;
   the Fundraiser checking what was uploaded about them; an Admin; nobody
   after a decision. This is not uniform, and "who can click this link" is the
   whole question.

3. **How long does a document live, and what happens to it when the
   verification it belonged to is irrelevant?** FFI-04 lets a Campaign be
   resubmitted without limit. A rejected attempt's documents are still
   someone's identity documents.

4. **What does the checklist mean without one?** Options: the row is disabled
   until a document of that type exists; it is ticked by the Verifier and the
   document is optional; or §7.1 is re-specified as a declaration rather than
   evidence. The third is a real option and changes the product's promise.

Decide this and the Fundraiser's create-campaign page, the Verifier's
moderation page, and the document checklist all stop being a guess.

## Answer

Owner (Dri), 2026-09-28, in the batch grilling round
([grilling-borongan-2026-09-28.md](../grilling-borongan-2026-09-28.md)),
answered "ya semua": the recommendation stands as the decision.

Object storage dengan signed URL berumur pendek (bukan `public/uploads` —
gerbang keamanan, layak diprioritaskan walau bukan Fase 2 murni); Verifier +
Fundraiser pemilik + Admin saja yang melihat, tautan kedaluwarsa; dokumen dari
pengajuan ditolak tetap disimpan tapi tak publik; baris checklist nonaktif
sampai dokumen ada (opsi lain membuat verifikasi jadi formalitas — persis
kritik tiket 02). Besar, layak jadi tiket implementasi terpisah begitu
keputusan turun; tak memblokir gerbang Fase 2 (uang keluar) tapi memblokir
soft launch yang jujur.
