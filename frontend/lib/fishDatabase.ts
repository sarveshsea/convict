export interface FishEntry {
  common_name: string
  species: string
  size_class: "small" | "medium" | "large"
  temperament: "aggressive" | "semi-aggressive" | "peaceful"
  estimated_length_cm: number
  region: "south_american" | "central_american" | "african" | "asian"
  notes?: string
}

export const CICHLID_DATABASE: FishEntry[] = [
  // ── South American ──────────────────────────────────────────────────────
  { common_name: "Oscar", species: "Astronotus ocellatus", size_class: "large", temperament: "semi-aggressive", estimated_length_cm: 35, region: "south_american", notes: "Tiger or albino morphs common" },
  { common_name: "Angelfish", species: "Pterophyllum scalare", size_class: "medium", temperament: "semi-aggressive", estimated_length_cm: 15, region: "south_american" },
  { common_name: "Altum Angelfish", species: "Pterophyllum altum", size_class: "large", temperament: "semi-aggressive", estimated_length_cm: 18, region: "south_american" },
  { common_name: "Discus", species: "Symphysodon aequifasciatus", size_class: "large", temperament: "peaceful", estimated_length_cm: 20, region: "south_american", notes: "Requires stable warm water" },
  { common_name: "Green Terror", species: "Andinoacara rivulatus", size_class: "large", temperament: "aggressive", estimated_length_cm: 30, region: "south_american" },
  { common_name: "Blue Acara", species: "Andinoacara pulcher", size_class: "medium", temperament: "semi-aggressive", estimated_length_cm: 18, region: "south_american" },
  { common_name: "Electric Blue Acara", species: "Andinoacara sp. 'Electric Blue'", size_class: "medium", temperament: "peaceful", estimated_length_cm: 15, region: "south_american" },
  { common_name: "Jack Dempsey", species: "Rocio octofasciata", size_class: "large", temperament: "aggressive", estimated_length_cm: 25, region: "central_american" },
  { common_name: "Electric Blue Jack Dempsey", species: "Rocio octofasciata 'Electric Blue'", size_class: "medium", temperament: "semi-aggressive", estimated_length_cm: 20, region: "central_american" },
  { common_name: "Severum", species: "Heros efasciatus", size_class: "large", temperament: "semi-aggressive", estimated_length_cm: 20, region: "south_american" },
  { common_name: "Gold Severum", species: "Heros efasciatus 'Gold'", size_class: "large", temperament: "peaceful", estimated_length_cm: 20, region: "south_american" },
  { common_name: "German Blue Ram", species: "Mikrogeophagus ramirezi", size_class: "small", temperament: "peaceful", estimated_length_cm: 7, region: "south_american" },
  { common_name: "Bolivian Ram", species: "Mikrogeophagus altispinosus", size_class: "small", temperament: "peaceful", estimated_length_cm: 8, region: "south_american" },
  { common_name: "Apistogramma Cockatoo", species: "Apistogramma cacatuoides", size_class: "small", temperament: "semi-aggressive", estimated_length_cm: 8, region: "south_american" },
  { common_name: "Apistogramma Agassizii", species: "Apistogramma agassizii", size_class: "small", temperament: "semi-aggressive", estimated_length_cm: 8, region: "south_american" },
  { common_name: "Apistogramma Borellii", species: "Apistogramma borellii", size_class: "small", temperament: "peaceful", estimated_length_cm: 6, region: "south_american" },
  { common_name: "Geophagus Brasiliensis", species: "Geophagus brasiliensis", size_class: "large", temperament: "peaceful", estimated_length_cm: 28, region: "south_american" },
  { common_name: "Geophagus Altifrons", species: "Geophagus altifrons", size_class: "large", temperament: "peaceful", estimated_length_cm: 30, region: "south_american" },
  { common_name: "Surinamensis", species: "Geophagus surinamensis", size_class: "large", temperament: "peaceful", estimated_length_cm: 28, region: "south_american" },
  { common_name: "Satanoperca Jurupari", species: "Satanoperca jurupari", size_class: "large", temperament: "peaceful", estimated_length_cm: 25, region: "south_american" },
  { common_name: "Flowerhorn", species: "Hybrid cichlid", size_class: "large", temperament: "aggressive", estimated_length_cm: 35, region: "central_american" },
  { common_name: "Blood Parrot", species: "Hybrid cichlid", size_class: "medium", temperament: "semi-aggressive", estimated_length_cm: 20, region: "central_american" },
  { common_name: "Red Terror", species: "Cichlasoma festae", size_class: "large", temperament: "aggressive", estimated_length_cm: 45, region: "south_american" },
  { common_name: "Wolf Cichlid (Dovii)", species: "Parachromis dovii", size_class: "large", temperament: "aggressive", estimated_length_cm: 60, region: "central_american" },
  { common_name: "Managuense (Jaguar)", species: "Parachromis managuensis", size_class: "large", temperament: "aggressive", estimated_length_cm: 55, region: "central_american" },
  { common_name: "Pike Cichlid", species: "Crenicichla sp.", size_class: "large", temperament: "aggressive", estimated_length_cm: 40, region: "south_american" },
  { common_name: "Eartheater (Gymnogeophagus)", species: "Gymnogeophagus balzanii", size_class: "medium", temperament: "peaceful", estimated_length_cm: 18, region: "south_american" },
  { common_name: "Checkerboard Cichlid", species: "Dicrossus filamentosus", size_class: "small", temperament: "peaceful", estimated_length_cm: 6, region: "south_american" },
  { common_name: "Laetacara Curviceps", species: "Laetacara curviceps", size_class: "small", temperament: "peaceful", estimated_length_cm: 8, region: "south_american" },
  { common_name: "Mesonauta Festivus", species: "Mesonauta festivus", size_class: "medium", temperament: "peaceful", estimated_length_cm: 15, region: "south_american" },
  { common_name: "Uaru", species: "Uaru amphiacanthoides", size_class: "large", temperament: "peaceful", estimated_length_cm: 25, region: "south_american" },

  // ── Central American ────────────────────────────────────────────────────
  { common_name: "Convict Cichlid", species: "Amatitlania nigrofasciata", size_class: "small", temperament: "aggressive", estimated_length_cm: 10, region: "central_american" },
  { common_name: "Firemouth Cichlid", species: "Thorichthys meeki", size_class: "medium", temperament: "semi-aggressive", estimated_length_cm: 17, region: "central_american" },
  { common_name: "Midas Cichlid", species: "Amphilophus citrinellus", size_class: "large", temperament: "aggressive", estimated_length_cm: 35, region: "central_american" },
  { common_name: "Red Devil", species: "Amphilophus labiatus", size_class: "large", temperament: "aggressive", estimated_length_cm: 35, region: "central_american" },
  { common_name: "Texas Cichlid", species: "Herichthys cyanoguttatus", size_class: "large", temperament: "aggressive", estimated_length_cm: 30, region: "central_american" },
  { common_name: "Sajica Cichlid", species: "Andinoacara coeruleopunctatus", size_class: "medium", temperament: "semi-aggressive", estimated_length_cm: 14, region: "central_american" },
  { common_name: "Honduran Red Point", species: "Amatitlania sp. 'Honduras'", size_class: "small", temperament: "semi-aggressive", estimated_length_cm: 10, region: "central_american" },
  { common_name: "Neetroplus (Poor Man's Tropheus)", species: "Neetroplus nematopus", size_class: "small", temperament: "aggressive", estimated_length_cm: 10, region: "central_american" },

  // ── African (Lake Malawi / Tanganyika / Victoria) ──────────────────────
  { common_name: "Electric Yellow Lab", species: "Labidochromis caeruleus", size_class: "small", temperament: "semi-aggressive", estimated_length_cm: 10, region: "african" },
  { common_name: "Frontosa", species: "Cyphotilapia frontosa", size_class: "large", temperament: "semi-aggressive", estimated_length_cm: 35, region: "african" },
  { common_name: "Peacock Cichlid (OB)", species: "Aulonocara sp.", size_class: "medium", temperament: "semi-aggressive", estimated_length_cm: 15, region: "african" },
  { common_name: "Peacock Cichlid (Blue)", species: "Aulonocara nyassae", size_class: "medium", temperament: "semi-aggressive", estimated_length_cm: 15, region: "african" },
  { common_name: "Venustus (Giraffe Cichlid)", species: "Nimbochromis venustus", size_class: "large", temperament: "aggressive", estimated_length_cm: 25, region: "african" },
  { common_name: "Bumblebee Cichlid", species: "Pseudotropheus crabro", size_class: "medium", temperament: "aggressive", estimated_length_cm: 16, region: "african" },
  { common_name: "Demasoni Cichlid", species: "Pseudotropheus demasoni", size_class: "small", temperament: "aggressive", estimated_length_cm: 8, region: "african" },
  { common_name: "Tropheus Duboisi", species: "Tropheus duboisi", size_class: "medium", temperament: "aggressive", estimated_length_cm: 14, region: "african" },
  { common_name: "Tropheus Moorii", species: "Tropheus moorii", size_class: "medium", temperament: "aggressive", estimated_length_cm: 14, region: "african" },
  { common_name: "Cynotilapia Afra", species: "Cynotilapia afra", size_class: "small", temperament: "aggressive", estimated_length_cm: 10, region: "african" },
  { common_name: "Julochromis", species: "Julidochromis transcriptus", size_class: "small", temperament: "semi-aggressive", estimated_length_cm: 9, region: "african" },
  { common_name: "Altolamprologus Calvus", species: "Altolamprologus calvus", size_class: "medium", temperament: "semi-aggressive", estimated_length_cm: 14, region: "african" },
  { common_name: "Neolamprologus Brichardi", species: "Neolamprologus brichardi", size_class: "small", temperament: "semi-aggressive", estimated_length_cm: 9, region: "african" },
  { common_name: "Cyphotilapia Gibberosa", species: "Cyphotilapia gibberosa", size_class: "large", temperament: "semi-aggressive", estimated_length_cm: 35, region: "african" },
  { common_name: "Chalinochromis Brichardi", species: "Chalinochromis brichardi", size_class: "small", temperament: "semi-aggressive", estimated_length_cm: 10, region: "african" },
  { common_name: "Haplochromis Burtoni", species: "Astatotilapia burtoni", size_class: "medium", temperament: "aggressive", estimated_length_cm: 12, region: "african" },
  { common_name: "Flametail (Otopharynx)", species: "Otopharynx lithobates", size_class: "medium", temperament: "semi-aggressive", estimated_length_cm: 14, region: "african" },
  { common_name: "Melanochromis Auratus", species: "Melanochromis auratus", size_class: "small", temperament: "aggressive", estimated_length_cm: 11, region: "african" },
  { common_name: "Red Zebra Cichlid", species: "Maylandia estherae", size_class: "small", temperament: "aggressive", estimated_length_cm: 12, region: "african" },
  { common_name: "Polystigma (Hap)", species: "Nimbochromis polystigma", size_class: "large", temperament: "aggressive", estimated_length_cm: 25, region: "african" },

  // ── Asian / Other Freshwater ─────────────────────────────────────────────
  { common_name: "Chromide (Orange)", species: "Etroplus maculatus", size_class: "small", temperament: "semi-aggressive", estimated_length_cm: 8, region: "asian" },
  { common_name: "Chromide (Green)", species: "Etroplus suratensis", size_class: "large", temperament: "semi-aggressive", estimated_length_cm: 40, region: "asian" },
]

export function searchFish(query: string): FishEntry[] {
  if (!query || query.length < 2) return []
  const q = query.toLowerCase().trim()
  return CICHLID_DATABASE.filter(
    (f) =>
      f.common_name.toLowerCase().includes(q) ||
      f.species.toLowerCase().includes(q) ||
      f.region.replace("_", " ").includes(q)
  ).slice(0, 8)
}
