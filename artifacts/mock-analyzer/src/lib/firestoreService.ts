import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  query, 
  where, 
  onSnapshot, 
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { db } from './firebase';

export type TopicGroup = 'Main' | 'Grammar';
export type Topic = { id: string; name: string; category: TopicGroup; attempted: number; correct: number; questions: number };
export type Mock = {
  id: string; 
  name: string; 
  date: string; 
  attempted: number; 
  correct: number; 
  wrong: number;
  unattempted: number; 
  score: number; 
  maxScore: number; 
  time: number; 
  topics: Topic[];
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
};

const MOCKS_COLLECTION = 'mocks';

export function subscribeUserMocks(userId: string, onUpdate: (mocks: Mock[]) => void, onError?: (err: Error) => void) {
  const q = query(collection(db, MOCKS_COLLECTION), where('userId', '==', userId));
  
  return onSnapshot(q, (snapshot) => {
    const mocksList: Mock[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      mocksList.push({
        id: docSnap.id,
        name: data.name || 'Untitled Mock',
        date: data.date || new Date().toISOString().slice(0, 10),
        attempted: Number(data.attempted || 0),
        correct: Number(data.correct || 0),
        wrong: Number(data.wrong || 0),
        unattempted: Number(data.unattempted || 0),
        score: Number(data.score || 0),
        maxScore: Number(data.maxScore || 50),
        time: Number(data.time || 20),
        topics: Array.isArray(data.topics) ? data.topics : [],
        userId: data.userId,
      });
    });
    // Sort by date descending
    mocksList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    onUpdate(mocksList);
  }, (err) => {
    console.error('Firestore subscription error:', err);
    if (onError) onError(err);
  });
}

export async function saveUserMockToCloud(userId: string, mock: Mock): Promise<void> {
  const mockRef = doc(db, MOCKS_COLLECTION, mock.id);
  const now = new Date().toISOString();
  await setDoc(mockRef, {
    userId,
    name: mock.name,
    date: mock.date,
    attempted: mock.attempted,
    correct: mock.correct,
    wrong: mock.wrong,
    unattempted: mock.unattempted,
    score: mock.score,
    maxScore: mock.maxScore,
    time: mock.time,
    topics: mock.topics,
    updatedAt: now,
    createdAt: mock.createdAt || now,
  }, { merge: true });
}

export async function deleteUserMockFromCloud(userId: string, mockId: string): Promise<void> {
  const mockRef = doc(db, MOCKS_COLLECTION, mockId);
  await deleteDoc(mockRef);
}

export async function syncLocalMocksToCloud(userId: string, localMocks: Mock[]): Promise<void> {
  if (!localMocks.length) return;
  
  // Check if user already has data in cloud
  const q = query(collection(db, MOCKS_COLLECTION), where('userId', '==', userId));
  const snapshot = await getDocs(q);
  
  // If user has no existing cloud mocks, upload local ones
  if (snapshot.empty) {
    const batch = writeBatch(db);
    const now = new Date().toISOString();
    localMocks.forEach(m => {
      const mockRef = doc(db, MOCKS_COLLECTION, m.id);
      batch.set(mockRef, {
        userId,
        name: m.name,
        date: m.date,
        attempted: m.attempted,
        correct: m.correct,
        wrong: m.wrong,
        unattempted: m.unattempted,
        score: m.score,
        maxScore: m.maxScore,
        time: m.time,
        topics: m.topics,
        createdAt: now,
        updatedAt: now,
      });
    });
    await batch.commit();
  }
}
