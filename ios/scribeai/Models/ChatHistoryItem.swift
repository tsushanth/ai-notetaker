//
//  ChatHistoryItem.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/20/25.
//


//
//  ChatModels.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//

import Foundation

// MARK: - Chat Models (Shared between UI and API)

struct ChatHistoryItem: Codable {
    let text: String
    let isUser: Bool
}

struct ChatResponse: Codable {
    let answer: String
    let note_id: String
}

struct ChatMessage: Codable, Identifiable {
    let id: String
    let role: String
    let text: String
    let timestamp = Date()
    
    var isUser: Bool {
        return role == "user"
    }
}
