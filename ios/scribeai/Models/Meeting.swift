//
//  Meeting.swift
//  scribeai
//
//  Meeting models for meeting bot functionality
//

import Foundation

// MARK: - Meeting Model

struct Meeting: Identifiable, Codable {
    let id: String
    let userId: String
    let title: String?
    let meetingUrl: String
    let platform: MeetingPlatform
    let status: MeetingStatus
    let scheduledStart: String?
    let actualStart: String?
    let actualEnd: String?
    let durationSeconds: Int?
    let errorMessage: String?
    let noteId: String?
    let createdAt: String
    let updatedAt: String

    var botRuns: [BotRun]?
    var meetingRecordings: [MeetingRecording]?

    enum CodingKeys: String, CodingKey {
        case id, title, platform, status
        case userId = "user_id"
        case meetingUrl = "meeting_url"
        case scheduledStart = "scheduled_start"
        case actualStart = "actual_start"
        case actualEnd = "actual_end"
        case durationSeconds = "duration_seconds"
        case errorMessage = "error_message"
        case noteId = "note_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case botRuns = "bot_runs"
        case meetingRecordings = "meeting_recordings"
    }

    /// Formatted duration string
    var formattedDuration: String? {
        guard let seconds = durationSeconds else { return nil }
        let minutes = seconds / 60
        let remainingSeconds = seconds % 60
        if minutes > 60 {
            let hours = minutes / 60
            let remainingMinutes = minutes % 60
            return String(format: "%d:%02d:%02d", hours, remainingMinutes, remainingSeconds)
        }
        return String(format: "%d:%02d", minutes, remainingSeconds)
    }

    /// Whether the meeting is currently in progress
    var isActive: Bool {
        status.isActive
    }

    /// Whether the meeting can be cancelled
    var isCancellable: Bool {
        status.isCancellable
    }
}

// MARK: - Meeting Status

enum MeetingStatus: String, Codable, CaseIterable {
    case pending
    case botJoining = "bot_joining"
    case inProgress = "in_progress"
    case recording
    case processing
    case transcribing
    case completed
    case failed
    case cancelled

    var displayText: String {
        switch self {
        case .pending: return "Waiting to join"
        case .botJoining: return "Bot joining..."
        case .inProgress: return "In meeting"
        case .recording: return "Recording"
        case .processing: return "Processing"
        case .transcribing: return "Transcribing"
        case .completed: return "Completed"
        case .failed: return "Failed"
        case .cancelled: return "Cancelled"
        }
    }

    var isActive: Bool {
        switch self {
        case .pending, .botJoining, .inProgress, .recording, .processing, .transcribing:
            return true
        case .completed, .failed, .cancelled:
            return false
        }
    }

    var isCancellable: Bool {
        switch self {
        case .pending, .botJoining, .inProgress, .recording:
            return true
        default:
            return false
        }
    }

    var iconName: String {
        switch self {
        case .pending: return "clock"
        case .botJoining: return "arrow.right.circle"
        case .inProgress: return "person.3.fill"
        case .recording: return "record.circle"
        case .processing: return "gearshape.2"
        case .transcribing: return "text.bubble"
        case .completed: return "checkmark.circle.fill"
        case .failed: return "xmark.circle.fill"
        case .cancelled: return "slash.circle"
        }
    }
}

// MARK: - Meeting Platform

enum MeetingPlatform: String, Codable, CaseIterable {
    case zoom
    case googleMeet = "google_meet"
    case teams
    case webex
    case other

    var displayName: String {
        switch self {
        case .zoom: return "Zoom"
        case .googleMeet: return "Google Meet"
        case .teams: return "Microsoft Teams"
        case .webex: return "Webex"
        case .other: return "Other"
        }
    }

    var iconName: String {
        // All use video icon but could be customized per platform
        return "video.fill"
    }

    var color: String {
        switch self {
        case .zoom: return "blue"
        case .googleMeet: return "green"
        case .teams: return "purple"
        case .webex: return "orange"
        case .other: return "gray"
        }
    }
}

// MARK: - Bot Run

struct BotRun: Identifiable, Codable {
    let id: String
    let meetingId: String
    let recallBotId: String?
    let status: String
    let joinTime: String?
    let leaveTime: String?
    let recordingPath: String?
    let transcriptRaw: String?

    enum CodingKeys: String, CodingKey {
        case id, status
        case meetingId = "meeting_id"
        case recallBotId = "recall_bot_id"
        case joinTime = "join_time"
        case leaveTime = "leave_time"
        case recordingPath = "recording_path"
        case transcriptRaw = "transcript_raw"
    }
}

// MARK: - Meeting Recording

struct MeetingRecording: Identifiable, Codable {
    let id: String
    let meetingId: String
    let botRunId: String?
    let storagePath: String
    let storageUrl: String?
    let fileSizeBytes: Int?
    let durationSeconds: Int?
    let format: String?
    let status: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, status, format
        case meetingId = "meeting_id"
        case botRunId = "bot_run_id"
        case storagePath = "storage_path"
        case storageUrl = "storage_url"
        case fileSizeBytes = "file_size_bytes"
        case durationSeconds = "duration_seconds"
        case createdAt = "created_at"
    }
}

// MARK: - API Response Types

struct MeetingResponse: Codable {
    let success: Bool
    let data: Meeting?
    let error: String?
}

struct MeetingsListResponse: Codable {
    let success: Bool
    let data: [Meeting]?
    let pagination: MeetingsPagination?
    let error: String?
}

struct MeetingsPagination: Codable {
    let page: Int
    let limit: Int
    let total: Int
    let pages: Int

    var hasMore: Bool {
        page < pages
    }
}

struct CreateMeetingResponse: Codable {
    let success: Bool
    let data: CreateMeetingData?
    let error: String?
}

struct CreateMeetingData: Codable {
    let meeting: Meeting
    let botRun: BotRun?
    let recallBotId: String?
}

struct ValidateMeetingUrlResponse: Codable {
    let success: Bool
    let data: ValidateMeetingUrlData?
    let error: String?
}

struct ValidateMeetingUrlData: Codable {
    let valid: Bool
    let platform: MeetingPlatform?
}

struct SupportedPlatformsResponse: Codable {
    let success: Bool
    let data: [SupportedPlatform]?
    let error: String?
}

struct SupportedPlatform: Codable {
    let id: String
    let name: String
    let urlExample: String
}

// MARK: - URL Validation Helper

struct MeetingURLValidator {
    /// Validate a meeting URL and detect the platform
    static func validate(_ url: String) -> (valid: Bool, platform: MeetingPlatform?) {
        let lowercased = url.lowercased()

        if lowercased.contains("zoom.us/j/") || lowercased.contains("zoom.us/my/") {
            return (true, .zoom)
        }

        if lowercased.contains("meet.google.com/") {
            return (true, .googleMeet)
        }

        if lowercased.contains("teams.microsoft.com") || lowercased.contains("teams.live.com") {
            return (true, .teams)
        }

        if lowercased.contains("webex.com") {
            return (true, .webex)
        }

        // Check for valid URL format but unknown platform
        if let urlObj = URL(string: url), urlObj.scheme?.hasPrefix("http") == true {
            return (false, nil)
        }

        return (false, nil)
    }
}
