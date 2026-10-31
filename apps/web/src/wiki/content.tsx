/** Page bodies by slug (see ./registry.ts for titles and order). */
import type { ComponentType } from "react";
import QuickStartPage from "./pages/quick-start";
import TheEstatePage from "./pages/the-estate";
import CreditsAndEntriesPage from "./pages/credits-and-entries";
import StatsAndAptitudesPage from "./pages/stats-and-aptitudes";
import GrowingUpPage from "./pages/growing-up";
import CareAndConditionPage from "./pages/care-and-condition";
import TrainingPage from "./pages/training";
import InjuriesAndInsurancePage from "./pages/injuries-and-insurance";
import InjuriesPage from "./pages/injuries";
import RaceTypesPage from "./pages/race-types";
import EnteringARacePage from "./pages/entering-a-race";
import JockeysPage from "./pages/jockeys";
import HowRacesAreRunPage from "./pages/how-races-are-run";
import WeatherAndGoingPage from "./pages/weather-and-going";
import RatingsAndFormPage from "./pages/ratings-and-form";
import RacecoursesPage from "./pages/racecourses";
import BreedingBasicsPage from "./pages/breeding-basics";
import GeneticsAndInheritancePage from "./pages/genetics-and-inheritance";
import BreedsPage from "./pages/breeds";
import FamilyLimitsPage from "./pages/family-limits";
import InbreedingPage from "./pages/inbreeding";
import CoatsAndMarkingsPage from "./pages/coats-and-markings";
import FragileLegsPage from "./pages/fragile-legs";
import RacingCareerPage from "./pages/racing-career";
import StudAndBroodmaresPage from "./pages/stud-and-broodmares";
import LegacyFarmPage from "./pages/legacy-farm";
import TheMarketPage from "./pages/the-market";
import UsdgMarketPage from "./pages/usdg-market";
import LeasingPage from "./pages/leasing";
import ClaimingRacesPage from "./pages/claiming-races";
import FacilitiesPage from "./pages/facilities";
import PacksPage from "./pages/packs";
import LeaguePage from "./pages/league";
import PlanningPage from "./pages/planning";
import RivalsAndNewsPage from "./pages/rivals-and-news";
import PicksAndTipstersPage from "./pages/picks-and-tipsters";
import DailyCupPage from "./pages/daily-cup";
import HallAndTrophiesPage from "./pages/hall-and-trophies";
import GlossaryPage from "./pages/glossary";
import TotePage from "./pages/tote";

export const WIKI_CONTENT: Record<string, ComponentType> = {
  "quick-start": QuickStartPage,
  "the-estate": TheEstatePage,
  "credits-and-entries": CreditsAndEntriesPage,
  "stats-and-aptitudes": StatsAndAptitudesPage,
  "growing-up": GrowingUpPage,
  "care-and-condition": CareAndConditionPage,
  "training": TrainingPage,
  injuries: InjuriesPage,
  "injuries-and-insurance": InjuriesAndInsurancePage,
  "race-types": RaceTypesPage,
  "entering-a-race": EnteringARacePage,
  jockeys: JockeysPage,
  "weather-and-going": WeatherAndGoingPage,
  "how-races-are-run": HowRacesAreRunPage,
  "ratings-and-form": RatingsAndFormPage,
  "racecourses": RacecoursesPage,
  "breeding-basics": BreedingBasicsPage,
  "genetics-and-inheritance": GeneticsAndInheritancePage,
  "breeds": BreedsPage,
  "family-limits": FamilyLimitsPage,
  "inbreeding": InbreedingPage,
  "coats-and-markings": CoatsAndMarkingsPage,
  "fragile-legs": FragileLegsPage,
  "racing-career": RacingCareerPage,
  "stud-and-broodmares": StudAndBroodmaresPage,
  "legacy-farm": LegacyFarmPage,
  "the-market": TheMarketPage,
  "leasing": LeasingPage,
  "claiming-races": ClaimingRacesPage,
  "usdg-market": UsdgMarketPage,
  "facilities": FacilitiesPage,
  "packs": PacksPage,
  "league": LeaguePage,
  "planning": PlanningPage,
  "rivals-and-news": RivalsAndNewsPage,
  "picks-and-tipsters": PicksAndTipstersPage,
  "daily-cup": DailyCupPage,
  "hall-and-trophies": HallAndTrophiesPage,
  "glossary": GlossaryPage,
  "tote": TotePage,
};
