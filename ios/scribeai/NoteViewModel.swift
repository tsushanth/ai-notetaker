//
//  NoteViewModel.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//  Updated with better token handling and pagination support
//

import Foundation

@MainActor
class NoteViewModel: ObservableObject {
    @Published var notes: [Note] = []
    @Published var isLoading = false
    @Published var isLoadingMore = false
    @Published var errorMessage: String?
    @Published var hasMoreNotes = true
    @Published var totalNotes = 0

    private var currentPage = 1
    private let pageSize = 20

    func loadNotes(token: String) async {
        isLoading = true
        errorMessage = nil
        currentPage = 1

        do {
            // APIService now handles token refresh automatically
            let result = try await APIService.shared.fetchNotesPaginated(
                token: token,
                page: currentPage,
                limit: pageSize
            )
            self.notes = result.notes
            self.hasMoreNotes = result.pagination?.hasMore ?? false
            self.totalNotes = result.pagination?.total ?? result.notes.count
            #if DEBUG
            print("✅ Loaded \(result.notes.count) notes (total: \(self.totalNotes), hasMore: \(self.hasMoreNotes))")
            #endif
        } catch APIError.unauthorized {
            // Token refresh failed - user needs to sign in again
            self.errorMessage = "Session expired. Please log in again."
            // Don't clear tokens here - let AuthViewModel handle navigation
            #if DEBUG
            print("❌ Unauthorized - session expired")
            #endif
        } catch {
            // Don't report or show error for cancelled requests (user navigated away)
            let isCancelled = (error as? URLError)?.code == .cancelled ||
                              error.localizedDescription == "cancelled" ||
                              (error as NSError).code == NSURLErrorCancelled

            if !isCancelled {
                self.errorMessage = error.localizedDescription
                #if DEBUG
                print("❌ Failed to load notes: \(error)")
                #endif
                ErrorReportingService.shared.reportError(flow: .fetchNotes, error: error)
            } else {
                #if DEBUG
                print("ℹ️ Notes fetch cancelled (user navigated away)")
                #endif
            }
        }

        isLoading = false
    }

    func loadMoreNotes(token: String) async {
        guard hasMoreNotes, !isLoadingMore, !isLoading else { return }

        isLoadingMore = true
        currentPage += 1

        do {
            let result = try await APIService.shared.fetchNotesPaginated(
                token: token,
                page: currentPage,
                limit: pageSize
            )

            // Append new notes (avoid duplicates)
            let existingIds = Set(notes.map { $0.id })
            let newNotes = result.notes.filter { !existingIds.contains($0.id) }
            self.notes.append(contentsOf: newNotes)

            self.hasMoreNotes = result.pagination?.hasMore ?? false
            self.totalNotes = result.pagination?.total ?? self.notes.count
            #if DEBUG
            print("✅ Loaded \(newNotes.count) more notes (page \(currentPage), total loaded: \(notes.count))")
            #endif
        } catch APIError.unauthorized {
            self.errorMessage = "Session expired. Please log in again."
            currentPage -= 1 // Revert page increment
        } catch {
            let isCancelled = (error as? URLError)?.code == .cancelled ||
                              (error as NSError).code == NSURLErrorCancelled

            if !isCancelled {
                self.errorMessage = error.localizedDescription
                #if DEBUG
                print("❌ Failed to load more notes: \(error)")
                #endif
            }
            currentPage -= 1 // Revert page increment
        }

        isLoadingMore = false
    }

    func deleteNote(token: String, noteId: String) async {
        do {
            try await APIService.shared.deleteNote(token: token, noteId: noteId)

            // Remove from local array
            self.notes.removeAll { $0.id == noteId }
            self.totalNotes = max(0, self.totalNotes - 1)
            #if DEBUG
            print("✅ Note deleted")
            #endif
        } catch APIError.unauthorized {
            self.errorMessage = "Session expired. Please log in again."
        } catch {
            self.errorMessage = error.localizedDescription
            ErrorReportingService.shared.reportError(flow: .deleteNote, error: error)
        }
    }

    func updateNoteTitle(token: String, noteId: String, newTitle: String) async -> Bool {
        do {
            let updatedNote = try await APIService.shared.updateNote(token: token, noteId: noteId, title: newTitle)

            // Update in local array
            if let index = self.notes.firstIndex(where: { $0.id == noteId }) {
                self.notes[index] = updatedNote
            }
            #if DEBUG
            print("✅ Note title updated")
            #endif
            return true
        } catch APIError.unauthorized {
            self.errorMessage = "Session expired. Please log in again."
            return false
        } catch {
            self.errorMessage = error.localizedDescription
            return false
        }
    }

    func refreshNotes(token: String) async {
        await loadNotes(token: token)
    }

    /// Clear notes (for sign out)
    func clearNotes() {
        notes = []
        errorMessage = nil
        currentPage = 1
        hasMoreNotes = true
        totalNotes = 0
        #if DEBUG
        print("🗑️ Notes cleared")
        #endif
    }
}
