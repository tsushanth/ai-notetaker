//
//  OnboardingSocialProofView.swift
//  scribeai
//
//  Social proof screen showing user count and testimonials
//

import SwiftUI

// MARK: - Testimonial Model
struct Testimonial: Identifiable {
    let id = UUID()
    let name: String
    let school: String
    let initials: String
    let rating: Int
    let quote: String
}

struct OnboardingSocialProofView: View {
    @ObservedObject private var manager = OnboardingManager.shared
    @State private var currentTestimonialIndex = 0

    let testimonials: [Testimonial] = [
        Testimonial(
            name: "Emma Chen",
            school: "Stanford",
            initials: "EC",
            rating: 5,
            quote: "Saved me weeks of work! Uploaded entire semester worth of lectures and got organized notes in minutes."
        ),
        Testimonial(
            name: "Marcus Johnson",
            school: "MIT",
            initials: "MJ",
            rating: 5,
            quote: "The flashcards and quizzes helped me ace my finals. Best study tool I've ever used!"
        ),
        Testimonial(
            name: "Sofia Rodriguez",
            school: "UCLA",
            initials: "SR",
            rating: 5,
            quote: "I listen to the AI podcasts during my commute. It's like having a personal tutor!"
        ),
        Testimonial(
            name: "David Kim",
            school: "Berkeley",
            initials: "DK",
            rating: 5,
            quote: "Game changer for medical school. The summaries capture everything important."
        )
    ]

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Big number
            VStack(spacing: 8) {
                Text("100K+")
                    .font(.system(size: 64, weight: .bold))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [Color.purple80, Color.purple80.opacity(0.7)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )

                Text("Students trust ScribeAI")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(.textPrimary)
            }

            Spacer()

            // Rating badge
            HStack(spacing: 16) {
                // Laurel left
                Image(systemName: "laurel.leading")
                    .font(.system(size: 32))
                    .foregroundColor(.yellow.opacity(0.7))

                VStack(spacing: 4) {
                    HStack(spacing: 4) {
                        Text("4.8")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundColor(.textPrimary)

                        HStack(spacing: 2) {
                            ForEach(0..<5) { _ in
                                Image(systemName: "star.fill")
                                    .font(.system(size: 16))
                                    .foregroundColor(.yellow)
                            }
                        }
                    }

                    Text("25K+ App Ratings")
                        .font(.system(size: 14))
                        .foregroundColor(.textSecondary)
                }

                // Laurel right
                Image(systemName: "laurel.trailing")
                    .font(.system(size: 32))
                    .foregroundColor(.yellow.opacity(0.7))
            }
            .padding(.vertical, 20)
            .padding(.horizontal, 24)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.cardBackground)
            )

            Spacer()

            // Testimonials section
            VStack(spacing: 16) {
                Text("What students are saying")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.textSecondary)

                // Testimonial Card
                TestimonialCard(testimonial: testimonials[currentTestimonialIndex])
                    .padding(.horizontal, 24)

                // Pagination dots
                HStack(spacing: 8) {
                    ForEach(0..<testimonials.count, id: \.self) { index in
                        Circle()
                            .fill(index == currentTestimonialIndex ? Color.purple80 : Color.textTertiary)
                            .frame(width: 8, height: 8)
                    }
                }
                .padding(.top, 8)
            }

            Spacer()

            // Continue button
            OnboardingPrimaryButton(title: "Join 100K+ Students") {
                manager.nextStep()
            }
            .padding(.bottom, 32)
        }
        .onAppear {
            startTestimonialRotation()
        }
    }

    private func startTestimonialRotation() {
        Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { _ in
            withAnimation(.easeInOut(duration: 0.5)) {
                currentTestimonialIndex = (currentTestimonialIndex + 1) % testimonials.count
            }
        }
    }
}

// MARK: - Testimonial Card
struct TestimonialCard: View {
    let testimonial: Testimonial

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                // Avatar
                ZStack {
                    Circle()
                        .fill(Color.pink.opacity(0.3))
                        .frame(width: 44, height: 44)

                    Text(testimonial.initials)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.pink)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(testimonial.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.textPrimary)

                    Text(testimonial.school)
                        .font(.system(size: 13))
                        .foregroundColor(.purple80)
                }

                Spacer()

                // Rating
                HStack(spacing: 2) {
                    ForEach(0..<testimonial.rating, id: \.self) { _ in
                        Image(systemName: "star.fill")
                            .font(.system(size: 12))
                            .foregroundColor(.yellow)
                    }
                }
            }

            // Quote
            Text(testimonial.quote)
                .font(.system(size: 15))
                .foregroundColor(.textSecondary)
                .lineSpacing(4)
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.cardBackground)
        )
    }
}

#Preview {
    ZStack {
        Color.darkBackground.ignoresSafeArea()
        OnboardingSocialProofView()
    }
}
