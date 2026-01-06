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
    let mindMapTitle: String?
    let mindMapNodes: [MindMapNode]?
    // Infographic fields
    let infographicImageUrl: String?
    let infographicExtractedData: InfographicExtractedData?
    let infographicStyle: String?
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
        case mindMapTitle = "title"
        case mindMapNodes = "nodes"
        case infographicImageUrl = "image_url"
        case infographicExtractedData = "extracted_data"
        case infographicStyle = "style"
        case createdAt = "created_at"
    }

    // Custom initializer with default nil for all optional fields
    init(id: String? = nil, noteId: String? = nil, audioUrl: String? = nil, duration: String? = nil, status: String? = nil, questions: QuizWrapper? = nil, flashcards: [Flashcard]? = nil, summary: String? = nil, mindMapTitle: String? = nil, mindMapNodes: [MindMapNode]? = nil, infographicImageUrl: String? = nil, infographicExtractedData: InfographicExtractedData? = nil, infographicStyle: String? = nil, createdAt: String? = nil) {
        self.id = id
        self.noteId = noteId
        self.audioUrl = audioUrl
        self.duration = duration
        self.status = status
        self.questions = questions
        self.flashcards = flashcards
        self.summary = summary
        self.mindMapTitle = mindMapTitle
        self.mindMapNodes = mindMapNodes
        self.infographicImageUrl = infographicImageUrl
        self.infographicExtractedData = infographicExtractedData
        self.infographicStyle = infographicStyle
        self.createdAt = createdAt
    }
}

// MARK: - Infographic Models

struct InfographicExtractedData: Codable {
    let title: String?
    let subtitle: String?
    let keyStats: [InfographicStat]?
    let mainSections: [InfographicSection]?
    let keyTakeaway: String?

    enum CodingKeys: String, CodingKey {
        case title, subtitle
        case keyStats = "key_stats"
        case mainSections = "main_sections"
        case keyTakeaway = "key_takeaway"
    }
}

struct InfographicStat: Codable {
    let value: String
    let label: String
}

struct InfographicSection: Codable {
    let title: String
    let points: [String]
}

// MARK: - Mind Map Models

struct MindMapNode: Codable, Identifiable {
    let id: String
    let label: String
    let content: String
    let level: Int
    let parentId: String?
    let color: String?
    let isExploratory: Bool?

    enum CodingKeys: String, CodingKey {
        case id, label, content, level, color
        case parentId = "parentId"
        case isExploratory = "isExploratory"
    }
}

struct MindMap: Identifiable {
    let id: String
    let noteId: String
    let title: String
    let nodes: [MindMapNode]
    let createdAt: String
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
