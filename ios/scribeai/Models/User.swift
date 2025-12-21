//
//  User.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//


import Foundation

struct User: Codable {
    let id: String
    let email: String
    let name: String?
    let createdAt: String
    
    enum CodingKeys: String, CodingKey {
        case id, email, name
        case createdAt = "created_at"
    }
}

struct AuthResponse: Codable {
    let success: Bool
    let data: AuthData?
    let error: String?
}

struct AuthData: Codable {
    let user: User
    let token: String
    let refreshToken: String?
    
    enum CodingKeys: String, CodingKey {
        case user, token
        case refreshToken = "refresh_token"
    }
}

// MARK: - AI Content Models (matching Android structure)

// MARK: - AI Content Wrapper (matching Android API structure)

struct AIContent: Codable {
    let id: String?
    let noteId: String?
    let audioUrl: String?
    let duration: String?
    let status: String?
    let questions: QuizWrapper?
    let flashcards: [Flashcard]?
    let summary: String?
    let createdAt: String?
    
    enum CodingKeys: String, CodingKey {
        case id
        case noteId = "note_id"
        case audioUrl = "audio_url"
        case duration
        case status
        case questions
        case flashcards
        case summary
        case createdAt = "created_at"
    }
}

struct QuizWrapper: Codable {
    let quizQuestions: [QuizQuestion]
    
    enum CodingKeys: String, CodingKey {
        case quizQuestions = "quiz_questions"
    }
}

// Response wrapper
struct AIContentResponse: Codable {
    let success: Bool
    let content: AIContent?
    let error: String?
}
