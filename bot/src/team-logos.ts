// Official LCK/LEC and Worlds logo assets published by https://lolesports.com/en-US/ (2026-10-20).
// Keep Leaguepedia as the fallback for teams outside this catalog.
const RIOT_TEAM_LOGOS: Record<string, string> = {
  anyoneslegend: "https://static.lolesports.com/teams/1641199582689_.png",
  bilibiligaming: "https://static.lolesports.com/teams/1682322954525_Bilibili_Gaming_logo_20211.png",
  ctbcflyingoyster: "https://static.lolesports.com/teams/1656307849320_CFO_Logo.png",
  cloud9kia: "https://static.lolesports.com/teams/1736924120254_C9Kia_IconBlue_Transparent_2000x2000.png",
  furia: "https://static.lolesports.com/teams/FURIA---black.png",
  invictusgaming: "https://static.lolesports.com/teams/1634762917340_300px-Invictus_Gaming_logo.png",
  los: "https://static.lolesports.com/teams/1784013312149_LOS-OLaranja.png",
  lyon: "https://static.lolesports.com/teams/1743717443673_isotypelyon-03.png",
  mvkesports: "https://static.lolesports.com/teams/1767089709161_White_Logo.png",
  topesports: "https://static.lolesports.com/teams/1592592064571_TopEsportsTES-01-FullonDark.png",
  teamliquidalienware: "https://static.lolesports.com/teams/1769357207762_TLAlienware_Minimal_Bug-White.png",
  teamsecretwhales: "https://static.lolesports.com/teams/1774598000328_White_EyeText_600p.png",
  t1: "https://static.lolesports.com/teams/1726801573959_539px-T1_2019_full_allmode.png",
  natusvincere: "https://static.lolesports.com/teams/1752746833620_NAVI_FullColor.png",
  skgaming: "https://static.lolesports.com/teams/1643979272144_SK_Monochrome.png",
  ktrolster: "https://static.lolesports.com/teams/kt_darkbackground.png",
  hanjinbrion: "https://static.lolesports.com/teams/1716454325887_Nowyprojekt.png",
  fnatic: "https://static.lolesports.com/teams/1631819669150_fnc-2021-worlds.png",
  hanwhalifeesports: "https://static.lolesports.com/teams/1631819564399_hle-2021-worlds.png",
  nongshimredforce: "https://static.lolesports.com/teams/NSFullonDark.png",
  karminecorp: "https://static.lolesports.com/teams/1704714951336_KC.png",
  bnkfearx: "https://static.lolesports.com/teams/1734691810721_BFXfullcolorfordarkbg.png",
  g2esports: "https://static.lolesports.com/teams/G2-FullonDark.png",
  kiwoomdrx: "https://static.lolesports.com/teams/1774247803537_horizontal_EN_Wh.png",
  teamvitality: "https://static.lolesports.com/teams/1675865863968_Vitality_FullColor.png",
  dnsoopers: "https://static.lolesports.com/teams/1767340467921_DN_SOOPerslogo_profile.webp",
  teamheretics: "https://static.lolesports.com/teams/1672933861879_Heretics-Full-Color.png",
  movistarkoi: "https://static.lolesports.com/teams/1734012609283_MKOI_FullColor_Blue.png",
  shifters: "https://static.lolesports.com/teams/1765897071435_600px-Shifters_allmode.png",
  giantx: "https://static.lolesports.com/teams/1765897105091_GIANTX-logotype-white.png",
  dpluskia: "https://static.lolesports.com/teams/1673260049703_DPlusKIALOGO11.png",
  geng: "https://static.lolesports.com/teams/1773829250929_GENGLOGO_GOLD.png",
};

export function officialTeamLogo(name: string): string | undefined {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string> = {
    gengesports: "geng", cloud9: "cloud9kia", teamliquid: "teamliquidalienware",
    shanghaiinvictusgamingmeituan: "invictusgaming",
  };
  return RIOT_TEAM_LOGOS[aliases[key] ?? key];
}
