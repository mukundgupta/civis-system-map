/*
 * Systems map data, transcribed from map.png.
 *
 * nodes[].star   -> node carried a pink star in the original map
 * edges[].sign   -> +1 / -1 polarity of the link (the default direction of effect)
 * edges[].weight -> OPTIONAL starting strength, 0..1, for the simulation. It is the
 *                   fraction of a change that passes along the link each tick, e.g.
 *                   0.7 => 70%. Combined with sign, so sign:-1 + weight:0.7 is a
 *                   "-70%" link. If omitted, links start at 70%. Users can change
 *                   these in the app (click a link's badge); their edits are saved
 *                   in the browser and override these starting values.
 * edges[].marked -> true where the original map showed a polarity symbol on the link.
 * edges[].bend   -> optional curvature override (negative bends the other way)
 *
 * Edit this file to change the map; loops and the simulation update automatically.
 */
window.MAP_DATA = {
  title: "Public consultation systems map",
  categories: {
    gov: { label: "Government", color: "#5b6cd9" },
    civis: { label: "CIVIS", color: "#1f9d8a" },
    society: { label: "Civil society & communities", color: "#d98a1f" },
    people: { label: "Participants & citizens", color: "#b45fbf" },
    trust: { label: "Trust & legitimacy", color: "#4f6f8a" }
  },

  nodes: [
    // Government
    { id: "policy", cat: "gov", x: 140, y: 90, label: "Policy not a mandate", sub: "Strength of formal consultation requirements" },
    { id: "govInt", cat: "gov", x: 140, y: 270, label: "Government interest", sub: "Governmental commitment to public consultation" },
    { id: "cipca", cat: "gov", x: 140, y: 470, label: "CIPCA awards", sub: "Institutional incentives and recognition for consultation quality" },
    { id: "draftLaws", cat: "gov", x: 430, y: 130, label: "Number of draft laws", sub: "Number of policies requiring consultation" },
    { id: "draftConsult", cat: "gov", x: 430, y: 330, label: "Number of draft laws for public consultation", sub: "Number of consultations opened to public participation" },
    { id: "extent", cat: "gov", x: 430, y: 560, label: "Extent of government incorporating feedback to the draft" },
    { id: "workload", cat: "gov", x: 730, y: 560, label: "Government administrative workload" },

    // CIVIS
    { id: "canEngage", cat: "civis", x: 770, y: 330, label: "Number of public consultations CIVIS can engage with" },
    { id: "laws5", cat: "civis", x: 1060, y: 150, label: "Number of laws CIVIS engages with in its 5 pillars" },
    { id: "commitment", cat: "civis", x: 1340, y: 150, label: "CIVIS's commitment / interest to issue-based outreach" },
    { id: "priority", cat: "civis", x: 1610, y: 150, label: "Priority outreach", star: true },
    { id: "capacity", cat: "civis", x: 1060, y: 490, label: "Available CIVIS workforce and processing capacity", sub: "(CIVIS workload)" },
    { id: "wfOps", cat: "civis", x: 1350, y: 490, label: "Available workforce for consultation operations" },
    { id: "motivation", cat: "civis", x: 1060, y: 640, label: "Perceived motivation to participate", star: true },
    { id: "quality", cat: "civis", x: 1060, y: 800, label: "Quality of explanation of public consultation on the CIVIS website and WhatsApp chatbot" },

    // Civil society & communities
    { id: "ngo", cat: "society", x: 1610, y: 330, label: "Number of NGO collaborations" },
    { id: "fbAff", cat: "society", x: 1890, y: 150, label: "Feedback from primarily affected people" },
    { id: "repr", cat: "society", x: 1890, y: 330, label: "Representation of affected communities" },

    // Participants & citizens
    { id: "filled", cat: "people", x: 730, y: 810, label: "Number of consultations filled" },
    { id: "welfare", cat: "people", x: 260, y: 760, label: "Welfare of citizens" },
    { id: "resultSeeing", cat: "people", x: 260, y: 950, label: "Result seeing" },
    { id: "returning", cat: "people", x: 120, y: 1130, label: "Participants coming back to CIVIS" },
    { id: "awareness", cat: "people", x: 560, y: 1110, label: "Awareness of the consultation process among first-time users", star: true },
    { id: "desire", cat: "people", x: 1060, y: 960, label: "Desire to give feedback" },
    { id: "currentAffairs", cat: "people", x: 150, y: 1350, label: "Awareness of current affairs" },
    { id: "valueRelevance", cat: "people", x: 440, y: 1350, label: "Perceived value of relevance" },
    { id: "needAction", cat: "people", x: 720, y: 1350, label: "Need to take action" },

    // Trust & legitimacy
    { id: "valueEff", cat: "trust", x: 1350, y: 960, label: "Perceived value and efficacy of participation", star: true },
    { id: "trustCivis", cat: "trust", x: 1620, y: 800, label: "Trust in CIVIS" },
    { id: "trustDem", cat: "trust", x: 1580, y: 1110, label: "Trust in democratic system", sub: "Perceived responsiveness of government institutions" },
    { id: "trustPC", cat: "trust", x: 1000, y: 1250, label: "Trust in public consultation" }
  ],

  edges: [
    // Government side
    { from: "policy", to: "govInt", sign: -1, marked: true },
    { from: "govInt", to: "draftLaws" },
    {
      from: "draftLaws", to: "draftConsult",
      note: "Institutional willingness to conduct meaningful consultations. More draft laws do not automatically mean more public consultations. It depends on: whether consultation is required, whether the ministry chooses to consult, whether time and resources are available, and whether the consultation is publicly accessible."
    },
    { from: "extent", to: "draftConsult" },
    { from: "workload", to: "extent", sign: -1, marked: true },
    { from: "extent", to: "cipca" },
    { from: "cipca", to: "govInt" },
    { from: "extent", to: "welfare" },
    { from: "filled", to: "extent" },
    { from: "filled", to: "workload" },

    // CIVIS side
    { from: "draftConsult", to: "canEngage" },
    { from: "canEngage", to: "laws5" },
    { from: "canEngage", to: "capacity" },
    { from: "laws5", to: "commitment" },
    { from: "commitment", to: "priority" },
    { from: "wfOps", to: "capacity", sign: -1, marked: true },
    { from: "capacity", to: "motivation", sign: -1, marked: true },
    { from: "motivation", to: "quality" },
    { from: "quality", to: "desire" },

    // Outreach & civil society
    { from: "priority", to: "fbAff" },
    { from: "fbAff", to: "repr" },
    { from: "repr", to: "filled" },
    { from: "priority", to: "ngo" },
    { from: "ngo", to: "priority" },
    { from: "ngo", to: "wfOps" },
    { from: "ngo", to: "trustCivis" },

    // Participation
    { from: "welfare", to: "resultSeeing" },
    { from: "filled", to: "resultSeeing" },
    { from: "resultSeeing", to: "awareness" },
    { from: "resultSeeing", to: "returning" },
    { from: "awareness", to: "desire" },
    { from: "desire", to: "filled" },
    { from: "desire", to: "returning" },

    // Trust
    { from: "welfare", to: "trustDem" },
    { from: "trustDem", to: "trustPC" },
    { from: "trustPC", to: "filled" },
    { from: "trustDem", to: "valueEff" },
    { from: "trustCivis", to: "valueEff" },
    { from: "valueEff", to: "desire" },

    // Loose chain (not connected to anything downstream in the original)
    { from: "currentAffairs", to: "valueRelevance" },
    { from: "valueRelevance", to: "needAction" }
  ]
};
