/* =========================================================================
   LaptopCare Portal — shared client configuration
   -------------------------------------------------------------------------
   Loaded by every page BEFORE the page's own script.
   These values are safe to keep public (Supabase anon key + RLS protect
   the data). To point the portal at a different Supabase project, edit
   the values in the "supabase" block below.
   ========================================================================= */
window.LC_CONFIG = {
  company: {
    name: "LaptopCare",
    portalName: "Warranty & Service Portal",
    address: "3F1, 3rd Floor, Unity Plaza, Colombo 04",
    phoneDisplay: "+94 775 741 069 / +94 776 786 786",
    phoneHref: "tel:+94775741069",
    website: "https://www.laptopcare.lk",
    websiteLabel: "www.laptopcare.lk",
    email: "laptopcareunity@gmail.com"
  },

  supabase: {
    url: "https://rqwetpbehyhbwvsokdjr.supabase.co",
    anonKey: "sb_publishable_GBVJTaa3lY3vcWdSwvxa8g_hV-JCdUn"
  },

  /* Table names in the Supabase project — rename here if yours differ. */
  tables: {
    warranty: "warranty_status",
    service: "service_status"
  },

  /* Lifecycle stages shown in the progress timelines. Keep these in sync
     with the options offered in the admin panel (admin.js uses the same
     lists so staff and customers always see matching stages). */
  warrantyStages: [
    "Received",
    "Diagnosis",
    "Parts Ordered",
    "In Repair",
    "Ready for Pickup",
    "Completed"
  ],
  serviceStages: [
    "Processing",
    "Scheduled",
    "Service in Progress",
    "Complete"
  ],
  holdStatus: "On Hold",

  /* Storage key for the customer's recent lookups (localStorage). */
  recentsKey: "laptopcare.recent"
};
