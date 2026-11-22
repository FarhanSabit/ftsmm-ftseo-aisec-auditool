import { Injectable, computed, signal } from '@angular/core';
import {
  GithubAuthProvider,
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  Timestamp,
  Unsubscribe,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  FIREBASE_AUTH_DOMAIN,
  FIREBASE_PROJECT_ID,
  OperationType,
  auth,
  db,
  handleFirestoreError,
} from '../firebase.config';
import {
  AuditCommit,
  AuditImpactMetrics,
  AuditMode,
  AuditRunPhase,
  AuditSession,
  SavedAuditHistoryRecord,
} from '../models/audit.model';

@Injectable({ providedIn: 'root' })
export class FirebaseAuthService {
  readonly currentUser = signal<User | null>(null);
  readonly isAuthReady = signal<boolean>(false);
  readonly isSigningIn = signal<boolean>(false);
  readonly authError = signal<string | null>(null);
  readonly showGithubSetupModal = signal<boolean>(false);
  readonly isHistoryDrawerOpen = signal<boolean>(false);
  readonly isSavingAudit = signal<boolean>(false);
  readonly saveSuccessBanner = signal<string | null>(null);
  readonly savedAudits = signal<SavedAuditHistoryRecord[]>([]);

  readonly projectId = FIREBASE_PROJECT_ID;
  readonly authDomain = FIREBASE_AUTH_DOMAIN;
  readonly firebaseProvidersConsoleUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`;
  readonly githubCallbackUrl = `https://${FIREBASE_AUTH_DOMAIN}/__/auth/handler`;

  readonly isAuthenticated = computed<boolean>(() => this.currentUser() !== null);

  readonly userDisplayLabel = computed<string>(() => {
    const u = this.currentUser();
    if (!u) return '';
    return u.displayName || u.email || 'GitHub Developer';
  });

  readonly userProviderBadge = computed<string>(() => {
    const u = this.currentUser();
    if (!u) return '';
    const isGithub = u.providerData?.some((p) => p.providerId === 'github.com');
    return isGithub ? 'GitHub' : 'Google';
  });

  private auditsUnsubscribe: Unsubscribe | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      onAuthStateChanged(auth, async (user) => {
        this.currentUser.set(user);
        this.isAuthReady.set(true);
        if (user) {
          try {
            await this.ensureUserProfileDocument(user);
          } catch {
            // Handled by handleFirestoreError
          }
          this.subscribeToUserAudits(user.uid);
        } else {
          this.unsubscribeFromUserAudits();
          this.savedAudits.set([]);
        }
      });
    }
  }

  private sanitizeId(raw: string): string {
    const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    return cleaned || 'audit_record_1';
  }

  private truncate(str: string | undefined | null, maxLen: number, fallback = ''): string {
    const val = (str ?? '').trim() || fallback;
    return val.slice(0, maxLen);
  }

  private clampMetric(val: number): number {
    if (!Number.isFinite(val)) return 0;
    return Math.max(0, Math.min(100, Math.round(val)));
  }

  async signInWithGitHub(): Promise<void> {
    this.isSigningIn.set(true);
    this.authError.set(null);
    try {
      const provider = new GithubAuthProvider();
      provider.addScope('read:user');
      await signInWithPopup(auth, provider);
      this.showGithubSetupModal.set(false);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      const msg = err instanceof Error ? err.message : String(err);

      if (
        code === 'auth/operation-not-allowed' ||
        code === 'auth/configuration-not-found' ||
        msg.includes('operation-not-allowed')
      ) {
        this.showGithubSetupModal.set(true);
        this.authError.set(
          'GitHub OAuth provider is not enabled yet in your Firebase Console. Follow the setup guide below or continue with Google Sign-In.'
        );
      } else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        this.authError.set(`GitHub sign-in error: ${msg}`);
      }
    } finally {
      this.isSigningIn.set(false);
    }
  }

  async signInWithGoogle(): Promise<void> {
    this.isSigningIn.set(true);
    this.authError.set(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      this.showGithubSetupModal.set(false);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      const msg = err instanceof Error ? err.message : String(err);
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        this.authError.set(`Sign-in error: ${msg}`);
      }
    } finally {
      this.isSigningIn.set(false);
    }
  }

  async signOutUser(): Promise<void> {
    this.unsubscribeFromUserAudits();
    await signOut(auth);
    this.savedAudits.set([]);
    this.isHistoryDrawerOpen.set(false);
  }

  toggleHistoryDrawer(): void {
    this.isHistoryDrawerOpen.set(!this.isHistoryDrawerOpen());
  }

  openGithubSetupGuide(): void {
    this.showGithubSetupModal.set(true);
  }

  closeGithubSetupGuide(): void {
    this.showGithubSetupModal.set(false);
  }

  private async ensureUserProfileDocument(user: User): Promise<void> {
    const uid = this.sanitizeId(user.uid);
    const userPath = `users/${uid}`;
    const userRef = doc(db, 'users', uid);

    const isGithub = user.providerData?.some((p) => p.providerId === 'github.com');
    const providerId: 'github.com' | 'google.com' = isGithub ? 'github.com' : 'google.com';
    const displayName = this.truncate(
      user.displayName || user.email?.split('@')[0] || 'Developer',
      120,
      'Developer'
    );
    const githubUsername = this.truncate(
      isGithub ? user.displayName || user.email?.split('@')[0] || '' : '',
      100,
      ''
    );
    const photoURL = this.truncate(user.photoURL || '', 500, '');

    try {
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid,
          displayName,
          githubUsername,
          photoURL,
          providerId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(userRef, {
          displayName,
          githubUsername,
          photoURL,
          providerId,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, userPath);
    }

    // Store PII (email) in isolated /users/{uid}/private/info document
    const privatePath = `users/${uid}/private/info`;
    const privateRef = doc(db, 'users', uid, 'private', 'info');
    const email = this.truncate(user.email || '', 254, '');

    try {
      const privSnap = await getDoc(privateRef);
      if (!privSnap.exists()) {
        await setDoc(privateRef, {
          uid,
          email,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(privateRef, {
          email,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, privatePath);
    }
  }

  private subscribeToUserAudits(uid: string): void {
    this.unsubscribeFromUserAudits();
    const sanitizedUid = this.sanitizeId(uid);
    const auditsQuery = query(collection(db, 'audits'), where('ownerId', '==', sanitizedUid));

    this.auditsUnsubscribe = onSnapshot(
      auditsQuery,
      (snapshot) => {
        const items: SavedAuditHistoryRecord[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const createdTs = data['createdAt'] as Timestamp | null | undefined;
          const updatedTs = data['updatedAt'] as Timestamp | null | undefined;
          items.push({
            auditId: String(data['auditId'] || docSnap.id),
            ownerId: String(data['ownerId'] || sanitizedUid),
            repoFullName: String(data['repoFullName'] || 'owner/repository'),
            repoUrl: String(data['repoUrl'] || 'https://github.com/owner/repository'),
            runPhase: (data['runPhase'] === 'lhr' ? 'lhr' : 'static') as AuditRunPhase,
            mode: (data['mode'] === 'demo' ? 'demo' : 'live') as AuditMode,
            totalCommitsCount: Number(data['totalCommitsCount'] ?? 0),
            selectedCommitsCount: Number(data['selectedCommitsCount'] ?? 0),
            performanceBefore: Number(data['performanceBefore'] ?? 64),
            performanceAfter: Number(data['performanceAfter'] ?? 92),
            accessibilityBefore: Number(data['accessibilityBefore'] ?? 70),
            accessibilityAfter: Number(data['accessibilityAfter'] ?? 95),
            bestPracticesBefore: Number(data['bestPracticesBefore'] ?? 76),
            bestPracticesAfter: Number(data['bestPracticesAfter'] ?? 94),
            seoBefore: Number(data['seoBefore'] ?? 80),
            seoAfter: Number(data['seoAfter'] ?? 96),
            securityBefore: Number(data['securityBefore'] ?? 72),
            securityAfter: Number(data['securityAfter'] ?? 92),
            summaryNotes: String(data['summaryNotes'] || ''),
            commitTitles: Array.isArray(data['commitTitles'])
              ? (data['commitTitles'] as unknown[]).map((c) => String(c))
              : [],
            createdAtIso: createdTs?.toDate ? createdTs.toDate().toISOString() : new Date().toISOString(),
            updatedAtIso: updatedTs?.toDate ? updatedTs.toDate().toISOString() : new Date().toISOString(),
          });
        });

        items.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
        this.savedAudits.set(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'audits');
      }
    );
  }

  private unsubscribeFromUserAudits(): void {
    if (this.auditsUnsubscribe) {
      this.auditsUnsubscribe();
      this.auditsUnsubscribe = null;
    }
  }

  async saveAuditToAccount(
    session: AuditSession,
    impact: AuditImpactMetrics,
    selectedCommits: AuditCommit[]
  ): Promise<void> {
    const user = this.currentUser();
    if (!user) {
      await this.signInWithGitHub();
      return;
    }

    this.isSavingAudit.set(true);
    this.saveSuccessBanner.set(null);

    const ownerId = this.sanitizeId(user.uid);
    const auditId = this.sanitizeId(`${ownerId}_${session.id}_${session.runPhase}`);
    const auditPath = `audits/${auditId}`;
    const auditRef = doc(db, 'audits', auditId);

    const commitTitles = selectedCommits
      .slice(0, 25)
      .map((c) => this.truncate(c.title, 240, 'Atomic audit commit'));

    const perfGain = this.clampMetric(impact.performanceAfter) - this.clampMetric(impact.performanceBefore);
    const a11yGain =
      this.clampMetric(impact.accessibilityAfter) - this.clampMetric(impact.accessibilityBefore);

    const summaryNotes = this.truncate(
      `${session.repo.fullName} (${session.runPhase === 'lhr' ? 'Run 2 LHR JSON' : 'Run 1 Static Audit'}): ${selectedCommits.length} of ${session.commits.length} commits selected. Performance +${Math.max(0, perfGain)} pts, Accessibility +${Math.max(0, a11yGain)} pts.`,
      1000,
      'Saved code audit snapshot'
    );

    try {
      await this.ensureUserProfileDocument(user);

      const existingSnap = await getDoc(auditRef);
      if (!existingSnap.exists()) {
        await setDoc(auditRef, {
          auditId,
          ownerId,
          repoFullName: this.truncate(session.repo.fullName, 200, 'owner/repository'),
          repoUrl: this.truncate(
            session.repo.url || `https://github.com/${session.repo.fullName}`,
            500,
            'https://github.com/owner/repository'
          ),
          runPhase: session.runPhase === 'lhr' ? 'lhr' : 'static',
          mode: session.mode === 'demo' ? 'demo' : 'live',
          totalCommitsCount: Math.max(0, Math.min(100, session.commits.length)),
          selectedCommitsCount: Math.max(0, Math.min(100, selectedCommits.length)),
          performanceBefore: this.clampMetric(impact.performanceBefore),
          performanceAfter: this.clampMetric(impact.performanceAfter),
          accessibilityBefore: this.clampMetric(impact.accessibilityBefore),
          accessibilityAfter: this.clampMetric(impact.accessibilityAfter),
          bestPracticesBefore: this.clampMetric(impact.bestPracticesBefore),
          bestPracticesAfter: this.clampMetric(impact.bestPracticesAfter),
          seoBefore: this.clampMetric(impact.seoBefore),
          seoAfter: this.clampMetric(impact.seoAfter),
          securityBefore: this.clampMetric(impact.securityBefore),
          securityAfter: this.clampMetric(impact.securityAfter),
          summaryNotes,
          commitTitles,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(auditRef, {
          selectedCommitsCount: Math.max(0, Math.min(100, selectedCommits.length)),
          performanceAfter: this.clampMetric(impact.performanceAfter),
          accessibilityAfter: this.clampMetric(impact.accessibilityAfter),
          bestPracticesAfter: this.clampMetric(impact.bestPracticesAfter),
          seoAfter: this.clampMetric(impact.seoAfter),
          securityAfter: this.clampMetric(impact.securityAfter),
          summaryNotes,
          commitTitles,
          updatedAt: serverTimestamp(),
        });
      }

      this.saveSuccessBanner.set(`Saved ${session.repo.fullName} to your account history`);
      setTimeout(() => {
        this.saveSuccessBanner.set(null);
      }, 3200);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, auditPath);
    } finally {
      this.isSavingAudit.set(false);
    }
  }

  async deleteSavedAudit(auditId: string): Promise<void> {
    const cleanId = this.sanitizeId(auditId);
    const path = `audits/${cleanId}`;
    try {
      await deleteDoc(doc(db, 'audits', cleanId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }
}
