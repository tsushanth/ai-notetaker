//
//  RevenueCatManager.swift
//  scribeai
//
//  DEPRECATED: RevenueCat has been removed. This file is kept only for the
//  ProductID constants used elsewhere. All purchase logic now goes through
//  PaywallKit's StoreManager (StoreKit 2).
//

import Foundation

// MARK: - Product IDs (kept for backward compatibility)

enum ScribeProductID {
    static let monthly  = "com.kreativekoala.scribeai.monthly"
    static let yearly   = "com.kreativekoala.scribeai.yearly"
    static let lifetime = "com.kreativekoala.scribeai.lifetime1"
}
