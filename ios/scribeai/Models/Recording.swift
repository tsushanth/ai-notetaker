//
//  Recording.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//


import Foundation

struct Recording: Identifiable, Codable {
    let id: String
    let userId: String
    let noteId: String?
    let title: String?
    let storagePath: String
    let fileUrl: String
    let fileSize: Int64
    let duration: Int?
    let format: String
    let status: String
    let transcriptionId: String?
    let createdAt: String
    let updatedAt: String
    
    enum CodingKeys: String, CodingKey {
        case id, title, duration, format, status
        case userId = "user_id"
        case noteId = "note_id"
        case storagePath = "storage_path"
        case fileUrl = "file_url"
        case fileSize = "file_size"
        case transcriptionId = "transcription_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct RecordingResponse: Codable {
    let success: Bool
    let data: Recording?
    let error: String?
}

struct TranscriptionResponse: Codable {
    let success: Bool
    let data: TranscriptionResult?
    let error: String?
}

struct TranscriptionResult: Codable {
    let recordingId: String
    let transcription: String
    let duration: Int
    let status: String
    let noteId: String?
    
    enum CodingKeys: String, CodingKey {
        case transcription, duration, status
        case recordingId = "recording_id"
        case noteId = "note_id"
    }
}

// MARK: - Podcast Models
struct Podcast: Codable, Identifiable {
    let id: String
    let noteId: String
    let audioUrl: String
    let duration: String?
    let status: String
    let createdAt: String
    
    enum CodingKeys: String, CodingKey {
        case id
        case noteId = "note_id"
        case audioUrl = "audio_url"
        case duration
        case status
        case createdAt = "created_at"
    }
}

struct PodcastResponse: Codable {
    let success: Bool
    let data: Podcast?
    let error: String?
}

// MARK: - Quiz Models
struct Quiz: Codable, Identifiable {
    let id: String
    let noteId: String
    let questions: [QuizQuestion]
    let createdAt: String
    
    enum CodingKeys: String, CodingKey {
        case id
        case noteId = "note_id"
        case questions
        case createdAt = "created_at"
    }
}

struct QuizQuestion: Codable, Identifiable {
    let id: String
    let question: String
    let options: [String]
    let correctAnswer: Int
    let explanation: String?
    
    enum CodingKeys: String, CodingKey {
        case question
        case options
        case correctAnswer = "correct_answer"
        case explanation
    }
    
    // Custom decoder to handle both string ("A", "B", "C", "D") and int (0, 1, 2, 3)
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        
        // Generate a unique ID from the question text
        self.question = try container.decode(String.self, forKey: .question)
        self.id = UUID().uuidString
        
        self.options = try container.decode([String].self, forKey: .options)
        self.explanation = try? container.decode(String.self, forKey: .explanation)
        
        // Handle correct_answer as either String or Int
        if let answerInt = try? container.decode(Int.self, forKey: .correctAnswer) {
            // Already an integer
            self.correctAnswer = answerInt
        } else if let answerString = try? container.decode(String.self, forKey: .correctAnswer) {
            // Convert "A", "B", "C", "D" to 0, 1, 2, 3
            switch answerString.uppercased() {
            case "A": self.correctAnswer = 0
            case "B": self.correctAnswer = 1
            case "C": self.correctAnswer = 2
            case "D": self.correctAnswer = 3
            default:
                // If it's a number as string like "0", "1", etc.
                self.correctAnswer = Int(answerString) ?? 0
            }
        } else {
            throw DecodingError.dataCorruptedError(
                forKey: .correctAnswer,
                in: container,
                debugDescription: "correct_answer must be either an Int or String"
            )
        }
    }
    
    // Regular init for manual creation
    init(id: String = UUID().uuidString, question: String, options: [String], correctAnswer: Int, explanation: String?) {
        self.id = id
        self.question = question
        self.options = options
        self.correctAnswer = correctAnswer
        self.explanation = explanation
    }
    
    // Encode back to JSON
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(question, forKey: .question)
        try container.encode(options, forKey: .options)
        try container.encode(correctAnswer, forKey: .correctAnswer)
        try container.encodeIfPresent(explanation, forKey: .explanation)
    }
}

struct QuizResponse: Codable {
    let success: Bool
    let data: Quiz?
    let error: String?
}

// MARK: - Flashcard Models
struct FlashcardSet: Codable, Identifiable {
    let id: String
    let noteId: String
    let cards: [Flashcard]
    let createdAt: String
    
    enum CodingKeys: String, CodingKey {
        case id
        case noteId = "note_id"
        case cards
        case createdAt = "created_at"
    }
}

struct Flashcard: Codable, Identifiable {
    let id: String
    let front: String
    let back: String
    
    // Custom decoder to generate ID if not present
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        
        // Try to decode id, or generate one if missing
        if let id = try? container.decode(String.self, forKey: .id) {
            self.id = id
        } else {
            self.id = UUID().uuidString
        }
        
        self.front = try container.decode(String.self, forKey: .front)
        self.back = try container.decode(String.self, forKey: .back)
    }
    
    // Regular init for manual creation
    init(id: String = UUID().uuidString, front: String, back: String) {
        self.id = id
        self.front = front
        self.back = back
    }
    
    enum CodingKeys: String, CodingKey {
        case id, front, back
    }
}

struct FlashcardResponse: Codable {
    let success: Bool
    let data: FlashcardSet?
    let error: String?
}

// MARK: - Chat Models
struct ChatHistory: Codable {
    let noteId: String
    let messages: [ChatMessage]
    
    enum CodingKeys: String, CodingKey {
        case noteId = "note_id"
        case messages
    }
}

struct ChatHistoryResponse: Codable {
    let success: Bool
    let data: [ChatMessage]?
    let error: String?
}
