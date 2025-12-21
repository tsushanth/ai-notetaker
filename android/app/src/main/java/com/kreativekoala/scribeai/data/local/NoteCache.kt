package com.kreativekoala.scribeai.data.local

import android.content.Context
import androidx.room.*
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.kreativekoala.scribeai.data.models.Note
import kotlinx.coroutines.flow.Flow

/**
 * Type converters for Room database
 */
class Converters {
    private val gson = Gson()

    @TypeConverter
    fun fromMetadata(value: Map<String, Any>?): String {
        return gson.toJson(value)
    }

    @TypeConverter
    fun toMetadata(value: String): Map<String, Any>? {
        val type = object : TypeToken<Map<String, Any>>() {}.type
        return gson.fromJson(value, type)
    }
}

/**
 * Room entity for cached notes
 */
@Entity(tableName = "notes_cache")
data class NoteEntity(
    @PrimaryKey
    val id: String,
    val userId: String,
    val title: String,
    val content: String,
    val sourceType: String?,
    val sourceUrl: String?,
    val metadata: Map<String, Any>?,
    val createdAt: String,
    val updatedAt: String,
    val lastSyncedAt: Long = System.currentTimeMillis(),
    val isDirty: Boolean = false // True if local changes not synced
)

/**
 * Convert between Note and NoteEntity
 */
fun Note.toEntity(userId: String): NoteEntity {
    return NoteEntity(
        id = this.id,
        userId = userId,
        title = this.title,
        content = this.content,
        sourceType = this.sourceType,
        sourceUrl = this.sourceUrl,
        metadata = this.metadata,
        createdAt = this.createdAt,
        updatedAt = this.updatedAt,
        lastSyncedAt = System.currentTimeMillis(),
        isDirty = false
    )
}

fun NoteEntity.toNote(): Note {
    return Note(
        id = this.id,
        title = this.title,
        content = this.content,
        sourceType = this.sourceType ?: "text",
        sourceUrl = this.sourceUrl,
        metadata = this.metadata,
        createdAt = this.createdAt,
        updatedAt = this.updatedAt,
        userId = this.userId
    )
}

/**
 * DAO for notes cache
 */
@Dao
interface NoteCacheDao {

    @Query("SELECT * FROM notes_cache WHERE userId = :userId ORDER BY createdAt DESC")
    fun getAllNotes(userId: String): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes_cache WHERE userId = :userId ORDER BY createdAt DESC")
    suspend fun getAllNotesSync(userId: String): List<NoteEntity>

    @Query("SELECT * FROM notes_cache WHERE id = :noteId LIMIT 1")
    suspend fun getNoteById(noteId: String): NoteEntity?

    @Query("SELECT COUNT(*) FROM notes_cache WHERE userId = :userId")
    suspend fun getNoteCount(userId: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertNote(note: NoteEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertNotes(notes: List<NoteEntity>)

    @Update
    suspend fun updateNote(note: NoteEntity)

    @Query("DELETE FROM notes_cache WHERE id = :noteId")
    suspend fun deleteNote(noteId: String)

    @Query("DELETE FROM notes_cache WHERE userId = :userId")
    suspend fun deleteAllNotes(userId: String)

    @Query("SELECT * FROM notes_cache WHERE isDirty = 1")
    suspend fun getDirtyNotes(): List<NoteEntity>

    @Query("UPDATE notes_cache SET isDirty = 0 WHERE id = :noteId")
    suspend fun markAsSynced(noteId: String)
}

/**
 * Room database
 */
@Database(
    entities = [NoteEntity::class],
    version = 1,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class ScribeDatabase : RoomDatabase() {
    abstract fun noteCacheDao(): NoteCacheDao

    companion object {
        @Volatile
        private var INSTANCE: ScribeDatabase? = null

        fun getInstance(context: Context): ScribeDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    ScribeDatabase::class.java,
                    "scribe_database"
                )
                    .fallbackToDestructiveMigration()
                    .build()

                INSTANCE = instance
                instance
            }
        }
    }
}

/**
 * RENAMED: Repository for managing LOCAL CACHED notes
 */
class NoteCacheRepository(private val dao: NoteCacheDao) {

    /**
     * Get all notes as Flow for reactive updates
     */
    fun getAllNotes(userId: String): Flow<List<NoteEntity>> {
        return dao.getAllNotes(userId)
    }

    /**
     * Get note count (for paywall check)
     */
    suspend fun getNoteCount(userId: String): Int {
        return dao.getNoteCount(userId)
    }

    /**
     * Cache notes from server
     */
    suspend fun cacheNotes(userId: String, notes: List<Note>) {
        val entities = notes.map { it.toEntity(userId) }
        dao.insertNotes(entities)
    }

    /**
     * Add new note to cache
     */
    suspend fun addNote(userId: String, note: Note) {
        dao.insertNote(note.toEntity(userId))
    }

    /**
     * Update existing note
     */
    suspend fun updateNote(userId: String, note: Note) {
        val entity = note.toEntity(userId).copy(isDirty = true)
        dao.updateNote(entity)
    }

    /**
     * Delete note from cache
     */
    suspend fun deleteNote(noteId: String) {
        dao.deleteNote(noteId)
    }

    /**
     * Get single note by ID
     */
    suspend fun getNoteById(noteId: String): Note? {
        return dao.getNoteById(noteId)?.toNote()
    }

    /**
     * Clear all cached notes (e.g., on logout)
     */
    suspend fun clearCache(userId: String) {
        dao.deleteAllNotes(userId)
    }
}