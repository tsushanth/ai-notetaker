# Onboarding & Free Trial Implementation Plan

## Overview

Transform the current subscription model from "7-day free trial then ask to subscribe" to "collect payment info upfront, charge after 7 days" with an engaging onboarding flow that collects user preferences and showcases app value.

---

## Current State

- **iOS**: Has `PaywallView.swift` with monthly/yearly subscription options
- **iOS**: No onboarding flow - users go straight to auth → home
- **iOS**: 7-day free trial exists but requires subscription after
- **Backend**: Has subscription tracking via `SubscriptionSyncService`

---

## Proposed Flow

### New User Onboarding Flow (iOS)

```
Sign Up → Onboarding Screens → Free vs Pro Comparison → Payment Info → 7-day Trial → Home
```

#### Screen 1: User Profile Selection
- "What describes you best?"
- Options: Undergraduate Student, High School Student, Middle School Student, Graduate Student, Professional, Educator, Other
- Progress bar at top (1/6)

#### Screen 2: Use Case Selection
- "What will you use ScribeAI for?"
- Options: Lecture Notes, Study Materials, Meeting Notes, Research, Personal Learning, Other
- Multi-select allowed

#### Screen 3: Feature Showcase - Upload
- "Upload Anything"
- PDFs, YouTube Videos, Audio
- Interactive demo: Drag sample content to upload zone
- Progress bar (2/6)

#### Screen 4: Feature Showcase - Notes
- "We'll create beautiful notes for you"
- Show sample note with diagrams
- Progress bar (3/6)

#### Screen 5: Feature Showcase - Flashcards
- "Master your terms"
- Interactive flashcard demo (tap to flip)
- Progress bar (4/7)

#### Screen 6: Feature Showcase - Quiz
- "Test your knowledge"
- Interactive quiz demo with sample question
- Multiple choice format, show correct/incorrect feedback
- Progress bar (5/7)

#### Screen 7: Feature Showcase - Audio
- "Learn on the go"
- Audio podcast player demo
- Progress bar (6/7)

#### Screen 8: Social Proof
- "X Students trust ScribeAI" (large number)
- App Store rating badge: "4.8 ⭐⭐⭐⭐⭐ - XX+ App Ratings"
- "What students are saying" section
- Testimonial carousel with student reviews:
  - Student name, school, star rating
  - Quote about how app helped them
- Pagination dots for multiple testimonials
- "Join X Students" button
- Progress bar (6/7)

#### Screen 9: Free vs Pro Comparison
- Similar to Blinkist screenshot
- Two columns: FREE | PRO
- Features comparison (currently all features free, but show Pro benefits):
  - Unlimited notes ✓ | ✓
  - AI Summaries ✓ | ✓
  - Quizzes & Flashcards ✓ | ✓
  - AI Podcasts ✓ | ✓
  - AI Chat ✓ | ✓
  - Priority Support - | ✓
  - Early Access to Features - | ✓
- Note: "All features currently free during beta!"
- "Continue" button → Trial screen

#### Screen 10: Trial Offer with Payment
- "Try ScribeAI Pro free for 7 days"
- Timeline:
  - Today: Free trial starts ✅
  - Day 5: Email reminder 📧
  - Day 7: Subscription begins (unless cancelled) ❤️
- **Price shown as per-week**: "Only $X.XX/week" (e.g., $7.99/month = $1.99/week)
- "7 days free, then $X.XX/month (just $X.XX/week)"
- "Start your free 7-day trial" button
- "Cancel anytime. Secure with App Store."
- Requires payment method (StoreKit handles this)
- **"Skip" option available** - takes user to home without trial

#### Screen 11: Notifications Permission
- "Never miss what matters"
- Show notification examples:
  - "Your YouTube video notes are ready!" 📹
  - "Quiz generated for Biology Chapter 3" 📝
  - "Your podcast is ready to listen" 🎧
- "Enable Notifications" / "Skip for now"

---

## Retention Screens (Sign Out / Delete Account)

When user tries to sign out or delete account, show value reminder:

### Sign Out Flow
1. User taps "Sign Out"
2. Show: "Are you sure? You'll lose access to:"
   - X notes you've created
   - X quizzes generated
   - X hours of audio content
3. Options: "Stay Signed In" (primary) | "Sign Out Anyway"

### Delete Account Flow
1. User taps "Delete Account"
2. Show same value reminder + "This cannot be undone"
3. **Deletion Reason Survey (multiple choice)**:
   - "Not useful for my needs"
   - "Too expensive"
   - "Found a better alternative"
   - "Privacy concerns"
   - "Technical issues"
   - "Other"
4. Final confirmation step
5. Track reason in analytics

---

## Backend Tracking Requirements

### New Analytics Events

```javascript
// Onboarding events
onboarding_started: { step: number }
onboarding_step_completed: { step: number, selection?: string }
onboarding_completed: { user_type: string, use_cases: string[] }
onboarding_skipped: { at_step: number }

// Trial events (enhance existing)
trial_started_with_payment: { product_id, trial_duration }
trial_reminder_sent: { days_remaining }
trial_converted: { product_id, price, currency }
trial_cancelled_before_charge: { days_used, reason? }

// Retention events
signout_attempted: {}
signout_value_shown: { notes_count, quizzes_count }
signout_cancelled: {}  // User stayed
signout_completed: {}

delete_account_attempted: {}
delete_account_value_shown: { notes_count, quizzes_count }
delete_account_cancelled: {}
delete_account_completed: { reason? }
```

### New API Endpoints

```
POST /api/users/onboarding
  - Save user preferences (user_type, use_cases)

GET /api/users/stats
  - Return { notes_count, quizzes_count, flashcards_count, audio_hours }
  - Used for retention screens

POST /api/analytics/event
  - Already exists, add new event types
```

### Database Schema Addition

```sql
-- Add to users table or create user_preferences table
ALTER TABLE users ADD COLUMN user_type VARCHAR(50);
ALTER TABLE users ADD COLUMN use_cases TEXT[]; -- Array of use cases
ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMP;
```

---

## Implementation Order

### Phase 1: Backend (1-2 days)
1. Add new analytics event types
2. Create `/api/users/onboarding` endpoint
3. Create `/api/users/stats` endpoint
4. Add database columns for user preferences

### Phase 2: iOS Onboarding Screens (2-3 days)
1. Create `OnboardingView.swift` with page controller
2. Create individual screen components:
   - `OnboardingUserTypeView.swift`
   - `OnboardingUseCaseView.swift`
   - `OnboardingFeatureView.swift` (reusable for demo screens)
   - `OnboardingComparisonView.swift`
   - `OnboardingTrialView.swift`
   - `OnboardingNotificationsView.swift`
3. Wire up navigation and state management
4. Save preferences to backend

### Phase 3: Trial with Payment (1-2 days)
1. Modify `StoreKitManager` to handle trial with payment upfront
2. Update `PaywallView` or create `TrialOfferView`
3. Ensure proper trial tracking with payment method attached
4. Handle trial → paid conversion automatically

### Phase 4: Retention Screens (1 day)
1. Create `SignOutConfirmationView.swift`
2. Create `DeleteAccountConfirmationView.swift`
3. Integrate with settings/profile
4. Add analytics tracking

### Phase 5: Testing & Polish (1 day)
1. Test full onboarding flow
2. Test trial → conversion
3. Test retention screens
4. Analytics verification

---

## Key Technical Considerations

### StoreKit 2 - Trial with Payment
- Use `Product.SubscriptionOffer` for introductory offers
- 7-day free trial is configured in App Store Connect
- Payment method is collected at trial start
- Automatic charge after trial unless cancelled

### State Management
- Store `hasCompletedOnboarding` in UserDefaults
- Store `userType` and `useCases` in backend
- Check onboarding status on app launch

### Navigation Flow
```swift
if !isAuthenticated {
    AuthView()
} else if !hasCompletedOnboarding {
    OnboardingView()
} else {
    HomeView()
}
```

---

## Files to Create/Modify

### New Files (iOS)
- `ios/scribeai/Onboarding/OnboardingView.swift` - Main container with page control
- `ios/scribeai/Onboarding/OnboardingUserTypeView.swift` - "What describes you best?"
- `ios/scribeai/Onboarding/OnboardingUseCaseView.swift` - "What will you use ScribeAI for?"
- `ios/scribeai/Onboarding/OnboardingFeatureView.swift` - Reusable feature demo screen
- `ios/scribeai/Onboarding/OnboardingQuizDemoView.swift` - Interactive quiz demo
- `ios/scribeai/Onboarding/OnboardingSocialProofView.swift` - "X Students trust ScribeAI"
- `ios/scribeai/Onboarding/OnboardingComparisonView.swift` - Free vs Pro comparison table
- `ios/scribeai/Onboarding/OnboardingTrialView.swift` - Trial offer with payment
- `ios/scribeai/Onboarding/OnboardingNotificationsView.swift` - Notification permission
- `ios/scribeai/Onboarding/OnboardingManager.swift` - State management
- `ios/scribeai/Retention/SignOutConfirmationView.swift` - Value reminder on sign out
- `ios/scribeai/Retention/DeleteAccountConfirmationView.swift` - Value reminder on delete
- `ios/scribeai/Retention/UserStatsService.swift` - Fetch user content stats

### Modified Files (iOS)
- `ios/scribeai/ContentView.swift` - Add onboarding check
- `ios/scribeai/SettingsView.swift` - Add retention flow
- `ios/scribeai/AuthViewModel.swift` - Add retention tracking
- `ios/scribeai/SubscriptionProduct.swift` - Trial handling

### New Files (Backend)
- `ai-notetaker-backend/src/routes/onboarding.js`

### Modified Files (Backend)
- `ai-notetaker-backend/src/routes/analytics.js` - New event types
- `ai-notetaker-backend/src/routes/users.js` - Stats endpoint

---

## Decisions Made

1. **Trial Duration**: 7 days (as currently configured)
2. **Skip Option**: Yes, users can skip onboarding and trial
3. **Free Tier**: All features free for now, monitor usage for future limits
4. **Notifications**: Content processed, quiz/format generated, podcast ready
5. **Delete Reason Survey**: Yes, multiple choice survey
6. **Price Display**: Show as per-week to seem more affordable (e.g., $1.99/week)
