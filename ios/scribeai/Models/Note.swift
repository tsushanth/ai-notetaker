//
//  Note.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//


import Foundation

struct Note: Identifiable, Codable {
    let id: String
    let userId: String
    let title: String
    let content: String
    let sourceType: String?
    let sourceUrl: String?
    let metadata: [String: AnyCodable]?
    let createdAt: String
    let updatedAt: String
    
    enum CodingKeys: String, CodingKey {
        case id, title, content, metadata
        case userId = "user_id"
        case sourceType = "source_type"
        case sourceUrl = "source_url"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct NoteResponse: Codable {
    let success: Bool
    let data: Note?
    let error: String?
}

struct NotesResponse: Codable {
    let success: Bool
    let data: [Note]?
    let pagination: NotesPagination?
    let error: String?
}

struct NotesPagination: Codable {
    let page: Int
    let limit: Int
    let total: Int
    let pages: Int

    var hasMore: Bool {
        page < pages
    }
}

// Helper for dynamic JSON
struct AnyCodable: Codable {
    let value: Any
    
    init(_ value: Any) {
        self.value = value
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else {
            value = [:]
        }
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let int = value as? Int {
            try container.encode(int)
        } else if let double = value as? Double {
            try container.encode(double)
        } else if let string = value as? String {
            try container.encode(string)
        } else if let bool = value as? Bool {
            try container.encode(bool)
        }
    }
}