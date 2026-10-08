/**
 * Dev seed: 9 farmers (one farm each), 5 extension agents, 2 buyers and an
 * admin, plus the verification rounds, produce and orders between them.
 * farmer-6..9 are verified with only in-stock, published listings across the
 * categories, so buyers always have a marketplace to browse and order from.
 *
 * Farmers and agents follow the password-less signup flows. A farmer is
 * active (can sign in with the seed password) once a round of their farm was
 * approved; the rest are pending, with no password. agent-1..3 are verified
 * by an admin and active; agent-4..5 have just signed up and are pending.
 *
 * Safe to re-run, including after a DB reset. Every user is a real Firebase
 * account (found by email, else created with a fixed uid) and its local row is
 * upserted on email. Every other row has a stable id hashed from a seed
 * key, so a re-run updates the same rows instead of duplicating them.
 *
 * Storage keys point at objects that were never uploaded: presigned URLs for
 * them resolve but 404.
 *
 *   pnpm seed   (needs DATABASE_URL and the FIREBASE_* admin vars in .env)
 *
 * The container runs it on start when SEED_ON_DEPLOY=true. Each run puts the
 * seed rows back as written here, so only set it where that is wanted.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth, type UserRecord } from 'firebase-admin/auth';
import {
  CheckResult,
  EvidenceKind,
  FarmVerificationStatus,
  IdType,
  OrderStatus,
  PhotoSlot,
  Prisma,
  PrismaClient,
  ProduceCategory,
  ProduceStatus,
  ProduceType,
  Role,
  VerificationCheckKey,
  VerificationTaskStatus,
} from '../generated/client';
import { clusterName } from '../src/agent/utils/cluster-name';
import { firebaseErrorCode } from '../src/auth/firebase/firebase.errors';
import { deriveProduceStatus } from '../src/produce/utils/produce-status';
import {
  checklistGaps,
  REQUIRED_PHOTOS,
} from '../src/verification/utils/checklist';

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const COMPLETE_CHECKLIST = {
  harvested: true,
  sorted: true,
  packaged: true,
  readyForPickup: true,
};

interface SeedUser {
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
}

interface SeedIdentity {
  idType: IdType;
  idNumber: string;
}

type AgentKey = 'agent-1' | 'agent-2' | 'agent-3' | 'agent-4' | 'agent-5';
type BuyerKey = 'buyer-1' | 'buyer-2';

interface SeedAgent extends SeedUser, SeedIdentity {
  key: AgentKey;
  state: string;
  lga: string;
  // Signed up through POST /agents/signup and not yet verified by an admin:
  // no password, isVerified false, locked out by ActivationGuard.
  pending?: boolean;
}

interface SeedCheck {
  key: VerificationCheckKey;
  result: CheckResult;
  note?: string;
}

interface SeedEvidence {
  kind: EvidenceKind;
  checkKey?: VerificationCheckKey;
  photoSlot?: PhotoSlot;
}

interface SeedRound {
  key: string;
  agent: AgentKey | null;
  status: VerificationTaskStatus;
  daysAgo: number;
  locationMatches?: boolean;
  discrepancy?: { lat: string; lng: string; note: string };
  identityNote?: string;
  measuredSize?: number;
  estimatedYield?: { value: number; unit: string };
  generalNote?: string;
  rejectionReason?: string;
  checks?: SeedCheck[];
  evidence?: SeedEvidence[];
  declines?: { agent: AgentKey; reason: string }[];
}

interface SeedOrder {
  key: string;
  buyer: BuyerKey;
  quantity: number;
  status: OrderStatus;
  daysAgo: number;
  cancellationReason?: string;
  // Only for PREPARING; READY and later always have every item ticked.
  checklist?: typeof COMPLETE_CHECKLIST;
}

interface SeedProduce {
  key: string;
  name: string;
  quantity: number;
  unit: string;
  pricePerUnit: string;
  // DRAFT or PUBLISHED; SOLD_OUT is derived from the orders.
  status: ProduceStatus;
  type: ProduceType;
  category: ProduceCategory;
  description: string;
  specs: string;
  orders: SeedOrder[];
}

interface SeedFarmer extends SeedUser, SeedIdentity {
  farm: {
    key: string;
    name: string;
    state: string;
    lga: string;
    location: string;
    size: number;
    mainProduce: string;
    isExporting: boolean;
    hasChiefConfirmation: boolean;
    referralAgent?: AgentKey;
    // Oldest first; the last round decides the farm's status and cluster.
    rounds: SeedRound[];
    produce: SeedProduce[];
  };
}

const AGENTS: SeedAgent[] = [
  {
    key: 'agent-1',
    email: 'agent1@laicos.test',
    firstName: 'Tunde',
    lastName: 'Adeyemi',
    phoneNumber: '+2348030000101',
    idType: IdType.NIN,
    idNumber: '10000000101',
    state: 'Oyo',
    lga: 'Ibadan North',
  },
  {
    key: 'agent-2',
    email: 'agent2@laicos.test',
    firstName: 'Aisha',
    lastName: 'Bello',
    phoneNumber: '+2348030000102',
    idType: IdType.VOTERS_CARD,
    idNumber: '90F5B1C2D3E4F5A6B7',
    state: 'Kaduna',
    lga: 'Zaria',
  },
  {
    key: 'agent-3',
    email: 'agent3@laicos.test',
    firstName: 'Ibrahim',
    lastName: 'Musa',
    phoneNumber: '+2348030000103',
    idType: IdType.NIN,
    idNumber: '10000000103',
    state: 'Kaduna',
    lga: 'Zaria',
  },
  {
    key: 'agent-4',
    email: 'agent4@laicos.test',
    firstName: 'Ngozi',
    lastName: 'Terver',
    phoneNumber: '+2348030000104',
    idType: IdType.NIN,
    idNumber: '10000000104',
    // Makurdi has no verified agent, which is why farm-5 waits unassigned.
    state: 'Benue',
    lga: 'Makurdi',
    pending: true,
  },
  {
    key: 'agent-5',
    email: 'agent5@laicos.test',
    firstName: 'Kunle',
    lastName: 'Oladipo',
    phoneNumber: '+2348030000105',
    idType: IdType.VOTERS_CARD,
    idNumber: '90E1F2A3B4C5D6E7F8',
    state: 'Oyo',
    lga: 'Ibadan North',
    pending: true,
  },
];

const BUYERS: (SeedUser & { key: BuyerKey })[] = [
  {
    key: 'buyer-1',
    email: 'buyer1@laicos.test',
    firstName: 'Chioma',
    lastName: 'Okafor',
    phoneNumber: '+2348030000201',
  },
  {
    key: 'buyer-2',
    email: 'buyer2@laicos.test',
    firstName: 'David',
    lastName: 'Eze',
    phoneNumber: '+2348030000202',
  },
];

const ADMIN: SeedUser = {
  key: 'admin-1',
  email: 'admin@laicos.test',
  firstName: 'Laicos',
  lastName: 'Admin',
  phoneNumber: '+2348030000301',
};

/** A complete, clean checklist: what an approved round records. */
function cleanChecks(overrides: SeedCheck[] = []): SeedCheck[] {
  const byKey = new Map(overrides.map((check) => [check.key, check]));
  return Object.values(VerificationCheckKey).map(
    (key) => byKey.get(key) ?? { key, result: CheckResult.VERIFIED },
  );
}

const REQUIRED_PHOTO_EVIDENCE: SeedEvidence[] = REQUIRED_PHOTOS.map(
  (photoSlot) => ({ kind: EvidenceKind.PHOTO, photoSlot }),
);

/** A round approved with nothing to flag. */
function cleanApproval(
  round: Pick<SeedRound, 'key' | 'agent' | 'daysAgo' | 'measuredSize'> & {
    identityNote: string;
    generalNote: string;
    estimatedYield: { value: number; unit: string };
  },
): SeedRound {
  return {
    ...round,
    status: VerificationTaskStatus.APPROVED,
    locationMatches: true,
    checks: cleanChecks(),
    evidence: REQUIRED_PHOTO_EVIDENCE,
  };
}

/** A published listing nobody has ordered yet: all of its stock is buyable. */
function inStock(produce: Omit<SeedProduce, 'status' | 'orders'>): SeedProduce {
  return { ...produce, status: ProduceStatus.PUBLISHED, orders: [] };
}

const FARMERS: SeedFarmer[] = [
  {
    key: 'farmer-1',
    email: 'farmer1@laicos.test',
    firstName: 'Olumide',
    lastName: 'Ajayi',
    phoneNumber: '+2348030000001',
    idType: IdType.NIN,
    idNumber: '20000000001',
    farm: {
      key: 'farm-1',
      name: 'Ajayi Maize Fields',
      state: 'Oyo',
      lga: 'Ibadan North',
      location: '14 Bodija Road, Ibadan',
      size: 5,
      mainProduce: 'Maize',
      isExporting: false,
      hasChiefConfirmation: true,
      referralAgent: 'agent-1',
      rounds: [
        {
          key: 'farm-1-round-1',
          agent: 'agent-1',
          status: VerificationTaskStatus.APPROVED,
          daysAgo: 20,
          locationMatches: true,
          identityNote: 'NIN slip and C of O match the farmer.',
          measuredSize: 4.8,
          estimatedYield: { value: 18, unit: 't' },
          generalNote: 'Well-kept farm, maize at tasselling stage.',
          checks: cleanChecks(),
          evidence: [
            ...REQUIRED_PHOTO_EVIDENCE,
            { kind: EvidenceKind.PHOTO, photoSlot: PhotoSlot.INFRASTRUCTURE },
          ],
        },
      ],
      produce: [
        {
          key: 'produce-1',
          name: 'White Maize',
          quantity: 1000,
          unit: 'kg',
          pricePerUnit: '450.00',
          status: ProduceStatus.PUBLISHED,
          type: ProduceType.LOCAL,
          category: ProduceCategory.GRAINS,
          description:
            'Sun-dried white maize, shelled and bagged in 50 kg sacks.',
          specs: 'Grade A — Moisture below 13%',
          orders: [
            {
              key: 'order-1',
              buyer: 'buyer-1',
              quantity: 100,
              status: OrderStatus.PENDING,
              daysAgo: 1,
            },
            {
              key: 'order-2',
              buyer: 'buyer-2',
              quantity: 150,
              status: OrderStatus.CONFIRMED,
              daysAgo: 3,
            },
            {
              key: 'order-3',
              buyer: 'buyer-1',
              quantity: 200,
              status: OrderStatus.PREPARING,
              daysAgo: 5,
              checklist: {
                ...COMPLETE_CHECKLIST,
                packaged: false,
                readyForPickup: false,
              },
            },
            {
              key: 'order-4',
              buyer: 'buyer-2',
              quantity: 50,
              status: OrderStatus.CANCELLED,
              daysAgo: 6,
              cancellationReason: 'Buyer no longer needs the stock.',
            },
          ],
        },
        {
          key: 'produce-2',
          name: 'Cassava Tubers',
          quantity: 300,
          unit: 'kg',
          pricePerUnit: '250.00',
          status: ProduceStatus.PUBLISHED,
          type: ProduceType.LOCAL,
          category: ProduceCategory.TUBERS,
          description: 'Freshly harvested premium cassava tubers.',
          specs: 'Grade A — Fresh Harvest',
          // Takes all the stock, so it derives to SOLD_OUT.
          orders: [
            {
              key: 'order-5',
              buyer: 'buyer-2',
              quantity: 300,
              status: OrderStatus.FULFILLED,
              daysAgo: 12,
            },
          ],
        },
      ],
    },
  },
  {
    key: 'farmer-2',
    email: 'farmer2@laicos.test',
    firstName: 'Fatima',
    lastName: 'Sani',
    phoneNumber: '+2348030000002',
    idType: IdType.VOTERS_CARD,
    idNumber: '90A1B2C3D4E5F6A7B8',
    farm: {
      key: 'farm-2',
      name: 'Sani Sesame Farm',
      state: 'Kaduna',
      lga: 'Zaria',
      location: 'Km 8 Zaria-Sokoto Road',
      size: 12,
      mainProduce: 'Sesame',
      isExporting: true,
      hasChiefConfirmation: false,
      rounds: [
        {
          key: 'farm-2-round-1',
          agent: 'agent-2',
          status: VerificationTaskStatus.APPROVED,
          daysAgo: 15,
          locationMatches: false,
          discrepancy: {
            lat: '11.112345',
            lng: '7.723456',
            note: 'Farm sits about 1 km north of the declared address.',
          },
          identityNote: 'Voter card matches; no chief letter was available.',
          measuredSize: 11.5,
          estimatedYield: { value: 9, unit: 't' },
          generalNote: 'Approved; access road floods in the rainy season.',
          checks: cleanChecks([
            {
              key: VerificationCheckKey.CHIEF_CONFIRMATION,
              result: CheckResult.UNABLE,
            },
            {
              key: VerificationCheckKey.ACCESS_ROUTE,
              result: CheckResult.ISSUE,
              note: 'Last 2 km is a dirt track, impassable after heavy rain.',
            },
          ]),
          evidence: [
            ...REQUIRED_PHOTO_EVIDENCE,
            { kind: EvidenceKind.LOCATION_DISCREPANCY },
            {
              kind: EvidenceKind.CHECK,
              checkKey: VerificationCheckKey.ACCESS_ROUTE,
            },
          ],
        },
      ],
      produce: [
        {
          key: 'produce-3',
          name: 'Premium Sesame Seeds',
          quantity: 2000,
          unit: 'kg',
          pricePerUnit: '1200.00',
          status: ProduceStatus.PUBLISHED,
          type: ProduceType.EXPORT,
          category: ProduceCategory.OILSEEDS,
          description: 'Hulled white sesame, machine-cleaned for export.',
          specs: '99% purity — FFA below 2%',
          orders: [
            {
              key: 'order-6',
              buyer: 'buyer-1',
              quantity: 500,
              status: OrderStatus.READY,
              daysAgo: 4,
            },
            {
              key: 'order-7',
              buyer: 'buyer-2',
              quantity: 400,
              status: OrderStatus.SHIPPED,
              daysAgo: 8,
            },
          ],
        },
        {
          key: 'produce-4',
          name: 'Soybeans',
          quantity: 800,
          unit: 'kg',
          pricePerUnit: '600.00',
          status: ProduceStatus.DRAFT,
          type: ProduceType.LOCAL,
          category: ProduceCategory.LEGUMES,
          description: 'Dry soybeans from the last harvest, not yet graded.',
          specs: 'Ungraded',
          orders: [],
        },
      ],
    },
  },
  {
    key: 'farmer-3',
    email: 'farmer3@laicos.test',
    firstName: 'Emeka',
    lastName: 'Nwosu',
    phoneNumber: '+2348030000003',
    idType: IdType.NIN,
    idNumber: '20000000003',
    farm: {
      key: 'farm-3',
      name: 'Nwosu Yam Estate',
      state: 'Oyo',
      lga: 'Ibadan North',
      location: '3 Agbowo Close, Ibadan',
      size: 3,
      mainProduce: 'Yam',
      isExporting: false,
      hasChiefConfirmation: true,
      referralAgent: 'agent-1',
      // Rejected once, resubmitted, and back with the same agent.
      rounds: [
        {
          key: 'farm-3-round-1',
          agent: 'agent-1',
          status: VerificationTaskStatus.REJECTED,
          daysAgo: 25,
          locationMatches: true,
          checks: [
            {
              key: VerificationCheckKey.FARM_OWNERSHIP,
              result: CheckResult.ISSUE,
              note: 'Ownership document names a different person.',
            },
          ],
          evidence: [
            {
              kind: EvidenceKind.CHECK,
              checkKey: VerificationCheckKey.FARM_OWNERSHIP,
            },
          ],
          rejectionReason:
            'Ownership document does not match the farmer. Upload a valid one.',
        },
        {
          key: 'farm-3-round-2',
          agent: 'agent-1',
          status: VerificationTaskStatus.IN_PROGRESS,
          daysAgo: 2,
          locationMatches: true,
          checks: [
            {
              key: VerificationCheckKey.FARMER_ID,
              result: CheckResult.VERIFIED,
            },
            {
              key: VerificationCheckKey.FARM_OWNERSHIP,
              result: CheckResult.VERIFIED,
            },
          ],
          evidence: [
            { kind: EvidenceKind.PHOTO, photoSlot: PhotoSlot.ENTRANCE },
          ],
        },
      ],
      // Never approved, so the farmer is pending and can't have listed any.
      produce: [],
    },
  },
  {
    key: 'farmer-4',
    email: 'farmer4@laicos.test',
    firstName: 'Halima',
    lastName: 'Yusuf',
    phoneNumber: '+2348030000004',
    idType: IdType.NIN,
    idNumber: '20000000004',
    farm: {
      key: 'farm-4',
      name: 'Yusuf Groundnut Farm',
      state: 'Kaduna',
      lga: 'Zaria',
      location: 'Samaru Village, Zaria',
      size: 6.5,
      mainProduce: 'Groundnut',
      isExporting: false,
      hasChiefConfirmation: true,
      // agent-2 declined, so it went to the other verified agent in Zaria.
      rounds: [
        {
          key: 'farm-4-round-1',
          agent: 'agent-3',
          status: VerificationTaskStatus.ASSIGNED,
          daysAgo: 1,
          declines: [
            {
              agent: 'agent-2',
              reason: 'Out of the LGA this week for a training.',
            },
          ],
        },
      ],
      produce: [],
    },
  },
  {
    key: 'farmer-5',
    email: 'farmer5@laicos.test',
    firstName: 'Terkaa',
    lastName: 'Iorliam',
    phoneNumber: '+2348030000005',
    idType: IdType.VOTERS_CARD,
    idNumber: '90C1D2E3F4A5B6C7D8',
    farm: {
      key: 'farm-5',
      name: 'Iorliam Rice Farm',
      state: 'Benue',
      lga: 'Makurdi',
      location: 'North Bank, Makurdi',
      size: 8,
      mainProduce: 'Rice',
      isExporting: false,
      hasChiefConfirmation: false,
      // No verified agent in Makurdi, so the round waits unassigned.
      rounds: [
        {
          key: 'farm-5-round-1',
          agent: null,
          status: VerificationTaskStatus.UNASSIGNED,
          daysAgo: 0,
        },
      ],
      produce: [],
    },
  },
  // farmer-6..9: verified farms whose listings are all in stock, for buyers.
  {
    key: 'farmer-6',
    email: 'farmer6@laicos.test',
    firstName: 'Bolanle',
    lastName: 'Adebayo',
    phoneNumber: '+2348030000006',
    idType: IdType.NIN,
    idNumber: '20000000006',
    farm: {
      key: 'farm-6',
      name: 'Adebayo Vegetable Gardens',
      state: 'Oyo',
      lga: 'Ibadan North',
      location: '22 Sango Road, Ibadan',
      size: 2.5,
      mainProduce: 'Tomato',
      isExporting: false,
      hasChiefConfirmation: true,
      rounds: [
        cleanApproval({
          key: 'farm-6-round-1',
          agent: 'agent-1',
          daysAgo: 18,
          identityNote: 'NIN slip and survey plan match the farmer.',
          measuredSize: 2.4,
          estimatedYield: { value: 12, unit: 't' },
          generalNote: 'Drip-irrigated beds, tomatoes and peppers fruiting.',
        }),
      ],
      produce: [
        inStock({
          key: 'produce-5',
          name: 'Roma Tomatoes',
          quantity: 800,
          unit: 'kg',
          pricePerUnit: '700.00',
          type: ProduceType.LOCAL,
          category: ProduceCategory.VEGETABLES,
          description: 'Firm, ripe Roma tomatoes packed in ventilated crates.',
          specs: 'Grade A — Fresh Harvest',
        }),
        inStock({
          key: 'produce-6',
          name: 'Scotch Bonnet Peppers',
          quantity: 200,
          unit: 'kg',
          pricePerUnit: '1500.00',
          type: ProduceType.LOCAL,
          category: ProduceCategory.VEGETABLES,
          description: 'Hot red and yellow ata rodo, picked to order.',
          specs: 'Grade A — Mixed colours',
        }),
        inStock({
          key: 'produce-7',
          name: 'Plantain',
          quantity: 150,
          unit: 'bunch',
          pricePerUnit: '3500.00',
          type: ProduceType.LOCAL,
          category: ProduceCategory.FRUITS,
          description: 'Mature green plantain bunches, 30–40 fingers each.',
          specs: 'Grade A — Unripe',
        }),
      ],
    },
  },
  {
    key: 'farmer-7',
    email: 'farmer7@laicos.test',
    firstName: 'Musa',
    lastName: 'Danjuma',
    phoneNumber: '+2348030000007',
    idType: IdType.VOTERS_CARD,
    idNumber: '90B7C8D9E0F1A2B3C4',
    farm: {
      key: 'farm-7',
      name: 'Danjuma Grain Farm',
      state: 'Kaduna',
      lga: 'Zaria',
      location: 'Dogarawa Village, Zaria',
      size: 15,
      mainProduce: 'Sorghum',
      isExporting: false,
      hasChiefConfirmation: true,
      rounds: [
        cleanApproval({
          key: 'farm-7-round-1',
          agent: 'agent-3',
          daysAgo: 22,
          identityNote: 'Voter card and chief letter match the farmer.',
          measuredSize: 14.6,
          estimatedYield: { value: 30, unit: 't' },
          generalNote: 'Large rain-fed holding with a lockable store on site.',
        }),
      ],
      produce: [
        inStock({
          key: 'produce-8',
          name: 'Red Sorghum',
          quantity: 5000,
          unit: 'kg',
          pricePerUnit: '380.00',
          type: ProduceType.LOCAL,
          category: ProduceCategory.GRAINS,
          description: 'Threshed and winnowed red sorghum in 100 kg bags.',
          specs: 'Grade A — Moisture below 12%',
        }),
        inStock({
          key: 'produce-9',
          name: 'Pearl Millet',
          quantity: 2000,
          unit: 'kg',
          pricePerUnit: '420.00',
          type: ProduceType.LOCAL,
          category: ProduceCategory.GRAINS,
          description: 'Clean grey pearl millet, stone-free.',
          specs: 'Grade B — Machine cleaned',
        }),
        inStock({
          key: 'produce-10',
          name: 'Brown Cowpea',
          quantity: 1500,
          unit: 'kg',
          pricePerUnit: '950.00',
          type: ProduceType.LOCAL,
          category: ProduceCategory.LEGUMES,
          description: 'Sweet brown beans, weevil-free and hand-sorted.',
          specs: 'Grade A — Hand sorted',
        }),
      ],
    },
  },
  {
    key: 'farmer-8',
    email: 'farmer8@laicos.test',
    firstName: 'Zainab',
    lastName: 'Abdullahi',
    phoneNumber: '+2348030000008',
    idType: IdType.NIN,
    idNumber: '20000000008',
    farm: {
      key: 'farm-8',
      name: 'Abdullahi Spice Farm',
      state: 'Kaduna',
      lga: 'Zaria',
      location: 'Shika Road, Zaria',
      size: 9,
      mainProduce: 'Ginger',
      isExporting: true,
      hasChiefConfirmation: true,
      rounds: [
        cleanApproval({
          key: 'farm-8-round-1',
          agent: 'agent-2',
          daysAgo: 10,
          identityNote: 'NIN slip, C of O and chief letter all match.',
          measuredSize: 9.2,
          estimatedYield: { value: 15, unit: 't' },
          generalNote: 'Export-ready drying yard and a sorting shed.',
        }),
      ],
      produce: [
        inStock({
          key: 'produce-11',
          name: 'Dried Split Ginger',
          quantity: 3000,
          unit: 'kg',
          pricePerUnit: '1800.00',
          type: ProduceType.EXPORT,
          category: ProduceCategory.SPICES,
          description: 'Sun-dried split ginger, sorted and bagged for export.',
          specs: 'Grade A — Moisture below 10%',
        }),
        inStock({
          key: 'produce-12',
          name: 'Raw Cashew Nuts',
          quantity: 2500,
          unit: 'kg',
          pricePerUnit: '1100.00',
          type: ProduceType.EXPORT,
          category: ProduceCategory.NUTS,
          description: 'In-shell raw cashew nuts from this season.',
          specs: 'KOR 47 lbs — Nut count 190/kg',
        }),
        inStock({
          key: 'produce-13',
          name: 'Dried Hibiscus Flowers',
          quantity: 1200,
          unit: 'kg',
          pricePerUnit: '1400.00',
          type: ProduceType.EXPORT,
          category: ProduceCategory.OTHER,
          description: 'Deep-red zobo calyces, shade-dried and cleaned.',
          specs: 'Grade A — Whole calyces',
        }),
      ],
    },
  },
  {
    key: 'farmer-9',
    email: 'farmer9@laicos.test',
    firstName: 'Yetunde',
    lastName: 'Ogunleye',
    phoneNumber: '+2348030000009',
    idType: IdType.VOTERS_CARD,
    idNumber: '90D4E5F6A7B8C9D0E1',
    farm: {
      key: 'farm-9',
      name: 'Ogunleye Tuber Farm',
      state: 'Oyo',
      lga: 'Ibadan North',
      location: '7 Ojoo Road, Ibadan',
      size: 4,
      mainProduce: 'Yam',
      isExporting: false,
      hasChiefConfirmation: false,
      rounds: [
        cleanApproval({
          key: 'farm-9-round-1',
          agent: 'agent-1',
          daysAgo: 8,
          identityNote: 'Voter card and ownership deed match the farmer.',
          measuredSize: 4.1,
          estimatedYield: { value: 20, unit: 't' },
          generalNote: 'Yam barn well ventilated; pineapples intercropped.',
        }),
      ],
      produce: [
        inStock({
          key: 'produce-14',
          name: 'Puna Yam',
          quantity: 400,
          unit: 'tuber',
          pricePerUnit: '2500.00',
          type: ProduceType.LOCAL,
          category: ProduceCategory.TUBERS,
          description: 'Large white puna yam tubers, 3–5 kg each.',
          specs: 'Grade A — Barn stored',
        }),
        inStock({
          key: 'produce-15',
          name: 'Sweet Potatoes',
          quantity: 600,
          unit: 'kg',
          pricePerUnit: '550.00',
          type: ProduceType.LOCAL,
          category: ProduceCategory.TUBERS,
          description: 'Orange-fleshed sweet potatoes, freshly lifted.',
          specs: 'Grade B — Mixed sizes',
        }),
        inStock({
          key: 'produce-16',
          name: 'Smooth Cayenne Pineapples',
          quantity: 300,
          unit: 'piece',
          pricePerUnit: '800.00',
          type: ProduceType.LOCAL,
          category: ProduceCategory.FRUITS,
          description: 'Sweet, half-coloured pineapples, 1.5–2 kg each.',
          specs: 'Grade A — Fresh Harvest',
        }),
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} must be set to seed`);
  }
  return value;
}

/**
 * A stable id per seed key, so a re-run upserts the same rows. Shaped as a v4
 * UUID because ParseUUIDPipe/IsUUID check the version bits.
 */
function seedId(key: string): string {
  const hex = createHash('sha1').update(`laicos-seed:${key}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/** A private-bucket key in the same `<prefix>/<uuid>.<ext>` shape as uploads. */
function seedKey(prefix: string, key: string, extension: string): string {
  return `${prefix}/${seedId(key)}.${extension}`;
}

/** `map.get(key)`, for keys the seed data guarantees are present. */
function mustGet<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Seed data references unknown key ${String(key)}`);
  }
  return value;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function isOpen(status: VerificationTaskStatus): boolean {
  return (
    status === VerificationTaskStatus.UNASSIGNED ||
    status === VerificationTaskStatus.ASSIGNED ||
    status === VerificationTaskStatus.IN_PROGRESS
  );
}

/** When an admin verified the agent, which lets them in; null while pending. */
function agentActivatedAt(agent: SeedAgent): Date | null {
  return agent.pending ? null : daysAgo(30);
}

/**
 * When the farmer's first round was approved, which is when
 * FarmerActivationService lets them in; null while no round has been.
 */
function farmerActivatedAt(farmer: SeedFarmer): Date | null {
  const approved = farmer.farm.rounds.find(
    (round) => round.status === VerificationTaskStatus.APPROVED,
  );
  return approved ? daysAgo(approved.daysAgo) : null;
}

function farmStatusOf(round: SeedRound): FarmVerificationStatus {
  switch (round.status) {
    case VerificationTaskStatus.APPROVED:
      return FarmVerificationStatus.VERIFIED;
    case VerificationTaskStatus.REJECTED:
      return FarmVerificationStatus.REJECTED;
    default:
      return FarmVerificationStatus.PENDING;
  }
}

// ---------------------------------------------------------------------------
// Firebase + users
// ---------------------------------------------------------------------------

/**
 * The Firebase account for `user`, created with a fixed uid if the email has
 * none. An active user gets the seed password (back), so seeded logins always
 * work. A pending one has no password, as after a password-less signup.
 */
async function ensureFirebaseUser(
  auth: Auth,
  user: SeedUser,
  password: string | null,
): Promise<UserRecord> {
  const profile = {
    email: user.email,
    displayName: `${user.firstName} ${user.lastName}`,
    // Signup leaves the email unverified; the seeded active users are not.
    emailVerified: password !== null,
  };
  let existing: UserRecord | null = null;
  try {
    existing = await auth.getUserByEmail(user.email);
  } catch (error) {
    if (firebaseErrorCode(error) !== 'auth/user-not-found') {
      throw error;
    }
  }
  if (existing && password) {
    return auth.updateUser(existing.uid, { ...profile, password });
  }
  const hasPassword = existing?.providerData.some(
    (provider) => provider.providerId === 'password',
  );
  if (existing && !hasPassword) {
    return auth.updateUser(existing.uid, profile);
  }
  // Firebase can't take a password off an account, so a pending user whose
  // account has one (from an earlier seed) is recreated without it.
  if (existing) {
    await auth.deleteUser(existing.uid);
  }
  return auth.createUser({
    uid: `seed-${user.key}`,
    ...profile,
    ...(password ? { password } : {}),
  });
}

/**
 * `access.activatedAt` is null for a pending farmer or agent, and for roles
 * that don't use it. Upserted on email: recreating a pending user's Firebase
 * account changes its uid.
 */
async function upsertUser(
  prisma: PrismaClient,
  auth: Auth,
  user: SeedUser,
  role: Role,
  access: { password: string | null; activatedAt: Date | null },
) {
  const firebaseUser = await ensureFirebaseUser(auth, user, access.password);
  const data = {
    firebaseUid: firebaseUser.uid,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phoneNumber: user.phoneNumber,
    role,
    agreedToTerms: true,
    isVerified: firebaseUser.emailVerified,
    activatedAt: access.activatedAt,
    mustChangePassword: false,
  };
  return prisma.user.upsert({
    where: { email: user.email },
    create: data,
    update: data,
  });
}

async function findLga(prisma: PrismaClient, state: string, lga: string) {
  return prisma.lga.findFirstOrThrow({
    where: { name: lga, state: { name: state } },
    select: { id: true, name: true, stateId: true },
  });
}

// ---------------------------------------------------------------------------
// Domain rows
// ---------------------------------------------------------------------------

async function seedAgent(
  prisma: PrismaClient,
  userId: string,
  agent: SeedAgent,
) {
  const lga = await findLga(prisma, agent.state, agent.lga);
  const name = clusterName(lga.name);
  const data = {
    stateId: lga.stateId,
    lgaId: lga.id,
    idType: agent.idType,
    idNumber: agent.idNumber,
    idDocumentKey: seedKey(`agents/${seedId(agent.key)}/id`, agent.key, 'pdf'),
    isVerified: !agent.pending,
    verifiedAt: agentActivatedAt(agent),
  };
  return prisma.agent.upsert({
    where: { userId },
    create: {
      id: seedId(agent.key),
      userId,
      ...data,
      cluster: { create: { name } },
    },
    update: {
      ...data,
      cluster: {
        upsert: {
          create: { name },
          update: { name },
        },
      },
    },
    include: { cluster: true },
  });
}

async function seedRound(
  prisma: PrismaClient,
  farmId: string,
  round: SeedRound,
  agentIds: Map<AgentKey, string>,
) {
  const id = seedId(round.key);
  const createdAt = daysAgo(round.daysAgo);
  const data = {
    farmId,
    agentId: round.agent && mustGet(agentIds, round.agent),
    status: round.status,
    locationMatches: round.locationMatches ?? null,
    discrepancyLat: round.discrepancy?.lat ?? null,
    discrepancyLng: round.discrepancy?.lng ?? null,
    discrepancyNote: round.discrepancy?.note ?? null,
    identityNote: round.identityNote ?? null,
    measuredSize: round.measuredSize ?? null,
    estimatedYield: round.estimatedYield?.value ?? null,
    estimatedYieldUnit: round.estimatedYield?.unit ?? null,
    generalNote: round.generalNote ?? null,
    rejectionReason: round.rejectionReason ?? null,
    startedAt:
      round.status === VerificationTaskStatus.UNASSIGNED ||
      round.status === VerificationTaskStatus.ASSIGNED
        ? null
        : createdAt,
    decidedAt: isOpen(round.status) ? null : createdAt,
    createdAt,
  };
  await prisma.farmVerification.upsert({
    where: { id },
    create: { id, ...data },
    update: data,
  });

  for (const check of round.checks ?? []) {
    const checkData = {
      verificationId: id,
      key: check.key,
      result: check.result,
      note: check.note ?? null,
    };
    await prisma.verificationCheck.upsert({
      where: { verificationId_key: { verificationId: id, key: check.key } },
      create: { id: seedId(`${round.key}:check:${check.key}`), ...checkData },
      update: checkData,
    });
  }

  for (const [index, item] of (round.evidence ?? []).entries()) {
    const evidenceId = seedId(`${round.key}:evidence:${index}`);
    const evidenceData = {
      verificationId: id,
      kind: item.kind,
      checkKey: item.checkKey ?? null,
      photoSlot: item.photoSlot ?? null,
      storageKey: seedKey(`verifications/${id}`, evidenceId, 'jpg'),
    };
    await prisma.verificationEvidence.upsert({
      where: { id: evidenceId },
      create: { id: evidenceId, ...evidenceData },
      update: evidenceData,
    });
  }

  for (const decline of round.declines ?? []) {
    const agentId = mustGet(agentIds, decline.agent);
    await prisma.assignmentDecline.upsert({
      where: { verificationId_agentId: { verificationId: id, agentId } },
      create: {
        id: seedId(`${round.key}:decline:${decline.agent}`),
        verificationId: id,
        agentId,
        reason: decline.reason,
      },
      update: { reason: decline.reason },
    });
  }

  return id;
}

/** Fails the seed if an approved round couldn't have been approved in-app. */
function assertApprovable(round: SeedRound) {
  if (round.status !== VerificationTaskStatus.APPROVED) {
    return;
  }
  const gaps = checklistGaps({
    locationMatches: round.locationMatches ?? null,
    discrepancyLat: round.discrepancy
      ? new Prisma.Decimal(round.discrepancy.lat)
      : null,
    discrepancyLng: round.discrepancy
      ? new Prisma.Decimal(round.discrepancy.lng)
      : null,
    discrepancyNote: round.discrepancy?.note ?? null,
    identityNote: round.identityNote ?? null,
    generalNote: round.generalNote ?? null,
    checks: (round.checks ?? []).map((check) => ({
      ...check,
      note: check.note ?? null,
    })),
    evidence: (round.evidence ?? []).map((item) => ({
      kind: item.kind,
      checkKey: item.checkKey ?? null,
      photoSlot: item.photoSlot ?? null,
    })),
    // Every seeded farmer and farm gets both documents (seedFarmers/seedFarms).
    farm: {
      ownershipDocumentKey: 'seeded',
      owner: { idDocumentKey: 'seeded' },
    },
  });
  if (gaps.length > 0) {
    throw new Error(
      `${round.key} is APPROVED but has gaps: ${gaps.join('; ')}`,
    );
  }
}

async function seedProduce(
  prisma: PrismaClient,
  farmId: string,
  produce: SeedProduce,
  buyerIds: Map<BuyerKey, string>,
) {
  const id = seedId(produce.key);
  // Stock follows the orders exactly as OrderService moves it: any live order
  // holds floating stock, and a confirmed (or later) one also holds actual.
  const live = produce.orders.filter(
    (order) => order.status !== OrderStatus.CANCELLED,
  );
  const committed = live.filter(
    (order) => order.status !== OrderStatus.PENDING,
  );
  const sum = (orders: SeedOrder[]) =>
    orders.reduce((total, order) => total + order.quantity, 0);
  const actualQuantity = produce.quantity - sum(committed);
  const floatingQuantity = produce.quantity - sum(live);

  const data = {
    farmId,
    name: produce.name,
    quantity: produce.quantity,
    actualQuantity,
    floatingQuantity,
    unit: produce.unit,
    pricePerUnit: produce.pricePerUnit,
    imageUrl: null,
    status: deriveProduceStatus(produce.status, {
      actualQuantity,
      floatingQuantity,
    }),
    type: produce.type,
    category: produce.category,
    description: produce.description,
    specs: produce.specs,
  };
  await prisma.produce.upsert({
    where: { id },
    create: { id, ...data },
    update: data,
  });

  for (const order of produce.orders) {
    const orderId = seedId(order.key);
    const orderData = {
      produceId: id,
      farmId,
      buyerId: mustGet(buyerIds, order.buyer),
      quantity: order.quantity,
      totalPrice: new Prisma.Decimal(produce.pricePerUnit).mul(order.quantity),
      status: order.status,
      produceName: produce.name,
      type: produce.type,
      cancellationReason: order.cancellationReason ?? null,
      createdAt: daysAgo(order.daysAgo),
    };
    await prisma.order.upsert({
      where: { id: orderId },
      create: { id: orderId, ...orderData },
      update: orderData,
    });

    const checklist = checklistFor(order);
    if (checklist) {
      await prisma.orderChecklist.upsert({
        where: { orderId },
        create: { orderId, ...checklist },
        update: checklist,
      });
    }
  }
}

/** The checklist an order in this status has; none before PREPARING. */
function checklistFor(order: SeedOrder) {
  switch (order.status) {
    case OrderStatus.PREPARING:
      return (
        order.checklist ?? {
          ...COMPLETE_CHECKLIST,
          packaged: false,
          readyForPickup: false,
        }
      );
    case OrderStatus.READY:
    case OrderStatus.SHIPPED:
    case OrderStatus.FULFILLED:
      return COMPLETE_CHECKLIST;
    default:
      return null;
  }
}

async function seedFarmer(
  prisma: PrismaClient,
  userId: string,
  farmer: SeedFarmer,
  agents: Map<AgentKey, { id: string; clusterId: string }>,
  buyerIds: Map<BuyerKey, string>,
) {
  const farmerId = seedId(farmer.key);
  const identity = {
    idType: farmer.idType,
    idNumber: farmer.idNumber,
    idDocumentKey: seedKey(`farmers/${farmerId}/id`, farmer.key, 'pdf'),
  };
  const { id: ownerId } = await prisma.farmer.upsert({
    where: { userId },
    create: { id: farmerId, userId, ...identity },
    update: identity,
  });

  const { farm } = farmer;
  const farmId = seedId(farm.key);
  const lga = await findLga(prisma, farm.state, farm.lga);
  const latest = farm.rounds[farm.rounds.length - 1];
  const verified = latest.status === VerificationTaskStatus.APPROVED;
  const clusterId =
    verified && latest.agent
      ? mustGet(agents, latest.agent).clusterId
      : undefined;
  const farmData = {
    ownerId,
    name: farm.name,
    stateId: lga.stateId,
    lgaId: lga.id,
    location: farm.location,
    size: farm.size,
    mainProduce: farm.mainProduce,
    isExporting: farm.isExporting,
    ownershipDocumentKey: seedKey(`farms/${farmId}/ownership`, farm.key, 'pdf'),
    chiefConfirmationKey: farm.hasChiefConfirmation
      ? seedKey(`farms/${farmId}/chief-confirmation`, farm.key, 'pdf')
      : null,
    // Denormalised from the latest round, as VerificationService writes it.
    verificationStatus: farmStatusOf(latest),
    clusterId: clusterId ?? null,
    isClustered: Boolean(clusterId),
    referralAgentId: farm.referralAgent
      ? mustGet(agents, farm.referralAgent).id
      : null,
  };
  await prisma.farm.upsert({
    where: { id: farmId },
    create: { id: farmId, ...farmData },
    update: farmData,
  });

  // A round created in-app since the last seed would trip the one-open-round
  // partial unique index when the seed reopens its own round, so the seed
  // owns this farm's round history outright.
  const roundIds = farm.rounds.map((round) => seedId(round.key));
  await prisma.farmVerification.deleteMany({
    where: { farmId, id: { notIn: roundIds } },
  });
  const agentIds = new Map(
    [...agents].map(([key, agent]) => [key, agent.id] as const),
  );
  for (const round of farm.rounds) {
    assertApprovable(round);
    await seedRound(prisma, farmId, round, agentIds);
  }

  // A pending farmer can't sign in, so can't have listed produce: drop any
  // an earlier seed gave them. Ordered produce stays, as orders are history.
  if (!farmerActivatedAt(farmer)) {
    await prisma.produce.deleteMany({
      where: { farmId, orders: { none: {} } },
    });
  }
  for (const produce of farm.produce) {
    await seedProduce(prisma, farmId, produce, buyerIds);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  // The deployed image always runs with NODE_ENV=production, so a deployed
  // environment opts in explicitly instead.
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.SEED_ON_DEPLOY !== 'true'
  ) {
    throw new Error(
      'Refusing to seed with NODE_ENV=production unless SEED_ON_DEPLOY=true',
    );
  }
  const password = process.env.SEED_USER_PASSWORD?.trim() || 'Laicos@2026';

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }),
  });
  const auth = getAuth(
    initializeApp({
      credential: cert({
        projectId: requireEnv('FIREBASE_PROJECT_ID'),
        clientEmail: requireEnv('FIREBASE_CLIENT_EMAIL'),
        privateKey: requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
      }),
    }),
  );

  try {
    // Buyers and the admin use the old password signup; activatedAt doesn't
    // apply to them.
    const passwordOnly = { password, activatedAt: null };
    await upsertUser(prisma, auth, ADMIN, Role.ADMIN, passwordOnly);

    const buyerIds = new Map<BuyerKey, string>();
    for (const buyer of BUYERS) {
      const user = await upsertUser(
        prisma,
        auth,
        buyer,
        Role.BUYER,
        passwordOnly,
      );
      buyerIds.set(buyer.key, user.id);
    }

    const agents = new Map<AgentKey, { id: string; clusterId: string }>();
    for (const agent of AGENTS) {
      const activatedAt = agentActivatedAt(agent);
      const user = await upsertUser(prisma, auth, agent, Role.EXTENSION_AGENT, {
        password: activatedAt && password,
        activatedAt,
      });
      const row = await seedAgent(prisma, user.id, agent);
      if (!row.cluster) {
        throw new Error(`${agent.key} has no cluster after seeding`);
      }
      agents.set(agent.key, { id: row.id, clusterId: row.cluster.id });
    }

    for (const farmer of FARMERS) {
      const activatedAt = farmerActivatedAt(farmer);
      const user = await upsertUser(prisma, auth, farmer, Role.FARMER, {
        password: activatedAt && password,
        activatedAt,
      });
      await seedFarmer(prisma, user.id, farmer, agents, buyerIds);
    }

    const pending: SeedUser[] = [
      ...AGENTS.filter((agent) => !agentActivatedAt(agent)),
      ...FARMERS.filter((farmer) => !farmerActivatedAt(farmer)),
    ];
    const active = [ADMIN, ...BUYERS, ...AGENTS, ...FARMERS].filter(
      (user) => !pending.includes(user),
    );
    console.log(
      `Seeded ${active.length} active users (password: ${password}):`,
    );
    for (const user of active) {
      console.log(`  ${user.email}`);
    }
    console.log(
      `Seeded ${pending.length} pending users (no password; sign-in answers 403 VERIFICATION_PENDING):`,
    );
    for (const user of pending) {
      console.log(`  ${user.email}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
