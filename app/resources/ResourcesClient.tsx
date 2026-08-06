'use client';

import { useEffect, useState, useRef } from 'react';
import { deleteResource, updateResource } from '@/lib/actions/resources';
import Link from 'next/link';
import Image from 'next/image';
import { renderSimpleMarkdown } from '@/app/components/utils/markdown';
import { UPLOAD_ACCEPT_ATTRIBUTE, rejectionReason } from '@/lib/utils/uploadable';

export type Resource = {
  id: string;
  title?: string | null;
  content: string;
  source: string;
  metadata?: any;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export default function ResourcesClient({
  initialResources,
  initialTotalCount,
  initialTags,
  initialCategories,
  pageSize,
}: {
  initialResources: Resource[];
  initialTotalCount: number;
  initialTags: string[];
  initialCategories: string[];
  pageSize: number;
}) {
  const [resources, setResources] = useState<Resource[]>(initialResources);
  const [loading, setLoading] = useState(false);
  const didMountRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagFilterInput, setTagFilterInput] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [categoryFilterInput, setCategoryFilterInput] = useState<string>('');
  const [allTags, setAllTags] = useState<string[]>(initialTags);
  const [allCategories, setAllCategories] = useState<string[]>(initialCategories);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [hasMore, setHasMore] = useState(initialResources.length < initialTotalCount);
  const limit = pageSize;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editType, setEditType] = useState<'note' | 'document' | 'image' | 'person' | 'project' | 'skill' | 'learning' | 'schedule' | 'event' | 'other'>('note');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editCategory, setEditCategory] = useState<string>('');
  const [newTagInput, setNewTagInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTagsAndCategories = async () => {
    try {
      const res = await fetch('/api/resources/tags');
      const data = await res.json();
      if (data.ok) {
        setAllTags(data.tags || []);
        setAllCategories(data.categories || []);
      }
    } catch (error) {
      console.error('Error loading tags:', error);
    }
  };

  const loadResources = async (page: number = currentPage) => {
    try {
      setLoading(true);
      const offset = (page - 1) * limit;
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });
      if (typeFilter) params.append('type', typeFilter);
      if (tagFilters.length > 0) {
        tagFilters.forEach(tag => params.append('tag', tag));
      }
      if (categoryFilter) params.append('category', categoryFilter);
      
      const res = await fetch(`/api/resources?${params}`);
      const data = await res.json();
      
      if (data.ok) {
        setResources(data.resources);
        setTotalCount(data.pagination.total);
        setHasMore(data.pagination.hasMore);
        setCurrentPage(page);
      }
    } catch (error) {
      console.error('Error loading resources:', error);
    } finally {
      setLoading(false);
    }
  };

  // Tags/categories are seeded from the server; no mount-time fetch needed.

  const addTagFilter = (tag: string) => {
    if (tag && !tagFilters.includes(tag)) {
      setTagFilters([...tagFilters, tag]);
      setTagFilterInput('');
      setShowTagSuggestions(false);
    }
  };

  const removeTagFilter = (tagToRemove: string) => {
    setTagFilters(tagFilters.filter(t => t !== tagToRemove));
  };

  useEffect(() => {
    // Sync input with filter
    if (categoryFilter) {
      setCategoryFilterInput(categoryFilter);
    } else {
      setCategoryFilterInput('');
    }
  }, [categoryFilter]);

  useEffect(() => {
    // Skip first mount — initial data is already seeded from the server.
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    setCurrentPage(1);
    loadResources(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, tagFilters, categoryFilter]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this resource?')) return;
    
    const result = await deleteResource(id);
    if (result.success) {
      setResources(prev => prev.filter(r => r.id !== id));
      setTotalCount(prev => Math.max(0, prev - 1));
      
      // If current page becomes empty and not first page, go to previous page
      if (resources.length === 1 && currentPage > 1) {
        loadResources(currentPage - 1);
      } else if (resources.length === 1) {
        // Reload current page if it becomes empty
        loadResources(currentPage);
      }
    } else {
      alert(result.message || 'Failed to delete resource');
    }
  };

  const handleEdit = (resource: Resource) => {
    setEditingId(resource.id);
    setEditTitle(resource.title || '');
    setEditContent(resource.content);
    const currentType = getTypeLabel(resource.metadata);
    setEditType(currentType as 'note' | 'document' | 'image' | 'person' | 'project' | 'skill' | 'learning' | 'schedule' | 'event' | 'other');
    const meta = resource.metadata as any;
    setEditTags(Array.isArray(meta?.tags) ? [...meta.tags] : []);
    setEditCategory(meta?.category || '');
  };

  const handleSave = async (id: string) => {
    const metadata: any = { 
      type: editType,
      tags: editTags.length > 0 ? editTags : undefined,
      category: editCategory || undefined,
    };
    
    const result = await updateResource(id, {
      title: editTitle || undefined,
      content: editContent,
      metadata,
    });
    
    if (result.success) {
      setResources(prev => prev.map(r => 
        r.id === id 
          ? { 
              ...r, 
              title: editTitle || null, 
              content: editContent, 
              metadata: { ...r.metadata, ...metadata },
              updatedAt: new Date() 
            }
          : r
      ));
      setEditingId(null);
      setEditTitle('');
      setEditContent('');
      setEditType('note');
      setEditTags([]);
      setEditCategory('');
      setNewTagInput('');
      // Reload tags to get updated list
      loadTagsAndCategories();
    } else {
      alert(result.message || 'Failed to update resource');
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditTitle('');
    setEditContent('');
    setEditType('note');
    setEditTags([]);
    setEditCategory('');
    setNewTagInput('');
  };

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !editTags.includes(trimmed)) {
      setEditTags([...editTags, trimmed]);
      if (!allTags.includes(trimmed)) {
        setAllTags([...allTags, trimmed].sort());
      }
    }
    setNewTagInput('');
  };

  const removeTag = (tagToRemove: string) => {
    setEditTags(editTags.filter(t => t !== tagToRemove));
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newTagInput.trim()) {
      e.preventDefault();
      addTag(newTagInput);
    }
  };

  // Client-side search filter (only filters by text, type is already filtered on backend)
  const filteredResources = resources.filter(r => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      (r.title?.toLowerCase().includes(query)) ||
      r.content.toLowerCase().includes(query)
    );
  });

  const getTypeLabel = (metadata: any) => {
    if (!metadata || typeof metadata !== 'object') return 'note';
    return metadata.type || 'note';
  };

  const formatDate = (date: string | Date) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    const rejection = rejectionReason(file);
    if (rejection) {
      alert(rejection);
      // Without this the same file cannot be picked again after fixing nothing,
      // because the input still holds it and fires no change event.
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);
    setUploadProgress(`Uploading ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/resources/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.ok) {
        setUploadProgress(`✓ Successfully uploaded ${file.name}`);
        // Reload resources to show the new one
        setTimeout(() => {
          loadResources(currentPage);
          setUploadProgress('');
        }, 1000);
      } else {
        setUploadProgress(`✗ Error: ${result.message || 'Upload failed'}`);
        setTimeout(() => setUploadProgress(''), 3000);
      }
    } catch (error) {
      setUploadProgress(`✗ Error: ${error instanceof Error ? error.message : 'Upload failed'}`);
      setTimeout(() => setUploadProgress(''), 3000);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Knowledge Base</h1>
        <div className="flex gap-2 items-center">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={UPLOAD_ACCEPT_ATTRIBUTE}
            onChange={handleFileUpload}
            disabled={uploading}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-primary btn-sm"
            disabled={uploading}
          >
            {uploading ? (
              <>
                <svg className="w-4 h-4 animate-spin mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Uploading...
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="w-4 h-4 mr-2 stroke-current">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                </svg>
                Upload File
              </>
            )}
          </button>
          <Link href="/tables" className="btn btn-outline btn-sm">
            My Tables
          </Link>
          <Link href="/" className="btn btn-outline btn-sm">
            Back to Chat
          </Link>
        </div>
      </div>

      {uploadProgress && (
        <div className={`alert ${uploadProgress.startsWith('✓') ? 'alert-success' : uploadProgress.startsWith('✗') ? 'alert-error' : 'alert-info'} shadow-lg`}>
          <div>
            <span>{uploadProgress}</span>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search resources..."
              className="input input-bordered w-full"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className="select select-bordered"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            <option value="note">Notes</option>
            <option value="document">Documents</option>
            <option value="person">People</option>
            <option value="project">Projects</option>
            <option value="skill">Skills</option>
            <option value="learning">Learning</option>
            <option value="schedule">Schedule</option>
          </select>
          <div className="relative min-w-[200px]">
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="Filter by tag..."
              value={tagFilterInput}
              onChange={(e) => {
                const value = e.target.value;
                setTagFilterInput(value);
                setShowTagSuggestions(true);
              }}
              onFocus={() => setShowTagSuggestions(true)}
              onBlur={() => setTimeout(() => setShowTagSuggestions(false), 200)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagFilterInput.trim()) {
                  const match = allTags.find(t => t.toLowerCase() === tagFilterInput.toLowerCase());
                  if (match && !tagFilters.includes(match)) {
                    addTagFilter(match);
                  } else if (match) {
                    setTagFilterInput('');
                    setShowTagSuggestions(false);
                  }
                }
              }}
            />
            {showTagSuggestions && tagFilterInput && (() => {
              const filteredTags = allTags.filter(tag => 
                tag.toLowerCase().includes(tagFilterInput.toLowerCase()) && 
                !tagFilters.includes(tag)
              );
              
              if (filteredTags.length > 0) {
                return (
                  <div className="absolute z-10 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredTags.slice(0, 20).map(tag => (
                      <button
                        key={tag}
                        type="button"
                        className="w-full text-left px-4 py-2 hover:bg-base-200"
                        onClick={() => addTagFilter(tag)}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                );
              } else {
                return (
                  <div className="absolute z-10 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg">
                    <div className="px-4 py-2 text-base-content/50">No tags found or all selected</div>
                  </div>
                );
              }
            })()}
          </div>
          <div className="relative min-w-[200px]">
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="Filter by category..."
              value={categoryFilterInput}
              onChange={(e) => {
                const value = e.target.value;
                setCategoryFilterInput(value);
                setShowCategorySuggestions(true);
                // Clear filter if input is empty
                if (!value.trim()) {
                  setCategoryFilter('');
                }
              }}
              onFocus={() => setShowCategorySuggestions(true)}
              onBlur={() => setTimeout(() => setShowCategorySuggestions(false), 200)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && categoryFilterInput.trim()) {
                  const match = allCategories.find(c => c.toLowerCase() === categoryFilterInput.toLowerCase());
                  if (match) {
                    setCategoryFilter(match);
                    setCategoryFilterInput(match);
                    setShowCategorySuggestions(false);
                  }
                }
              }}
            />
            {categoryFilter && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <button
                  className="btn btn-xs btn-circle btn-ghost"
                  onClick={() => {
                    setCategoryFilter('');
                    setCategoryFilterInput('');
                  }}
                  title="Clear category filter"
                >
                  ✕
                </button>
              </div>
            )}
            {showCategorySuggestions && categoryFilterInput && (() => {
              const filteredCategories = allCategories.filter(cat => 
                cat.toLowerCase().includes(categoryFilterInput.toLowerCase())
              );
              
              if (filteredCategories.length > 0) {
                return (
                  <div className="absolute z-10 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredCategories.slice(0, 20).map(cat => (
                      <button
                        key={cat}
                        type="button"
                        className="w-full text-left px-4 py-2 hover:bg-base-200 flex items-center justify-between"
                        onClick={() => {
                          setCategoryFilter(cat);
                          setCategoryFilterInput(cat);
                          setShowCategorySuggestions(false);
                        }}
                      >
                        <span>{cat}</span>
                        {categoryFilter === cat && <span className="text-primary">✓</span>}
                      </button>
                    ))}
                  </div>
                );
              } else {
                return (
                  <div className="absolute z-10 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg">
                    <div className="px-4 py-2 text-base-content/50">No categories found</div>
                  </div>
                );
              }
            })()}
          </div>
        </div>
        {(tagFilters.length > 0 || categoryFilter) && (
          <div className="flex gap-2 items-center flex-wrap">
            {tagFilters.map(tag => (
              <div key={tag} className="badge badge-primary gap-2">
                Tag: {tag}
                <button
                  className="btn btn-xs btn-circle btn-ghost"
                  onClick={() => removeTagFilter(tag)}
                >
                  ✕
                </button>
              </div>
            ))}
            {categoryFilter && (
              <div className="badge badge-secondary gap-2">
                Category: {categoryFilter}
                <button
                  className="btn btn-xs btn-circle btn-ghost"
                  onClick={() => setCategoryFilter('')}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {loading && resources.length === 0 ? (
        <div className="text-center py-8">Loading resources...</div>
      ) : filteredResources.length === 0 ? (
        <div className="text-center py-8 text-base-content/70">
          {searchQuery ? 'No resources match your search' : 'No resources found'}
        </div>
      ) : (
        <>
          <div className="grid gap-4">
            {filteredResources.map((resource) => (
              <div key={resource.id} className="rounded-lg border border-base-300 bg-base-100">
                <div className="p-4 md:p-5">
                  {editingId === resource.id ? (
                    <div className="space-y-4">
                      <input
                        type="text"
                        placeholder="Title (optional)"
                        className="input input-bordered w-full"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                      <select
                        className="select select-bordered w-full"
                        value={editType}
                        onChange={(e) => setEditType(e.target.value as typeof editType)}
                      >
                        <option value="note">Note</option>
                        <option value="document">Document</option>
                        <option value="image">Image</option>
                        <option value="person">Person</option>
                        <option value="project">Project</option>
                        <option value="skill">Skill</option>
                        <option value="learning">Learning</option>
                        <option value="schedule">Schedule</option>
                        <option value="event">Event</option>
                        <option value="other">Other</option>
                      </select>
                      <div>
                        <label className="label">
                          <span className="label-text">Category (optional)</span>
                        </label>
                        <input
                          type="text"
                          className="input input-bordered w-full"
                          placeholder="e.g., work, personal, learning"
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          list="category-suggestions"
                        />
                        <datalist id="category-suggestions">
                          {allCategories.map(cat => (
                            <option key={cat} value={cat} />
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <label className="label">
                          <span className="label-text">Tags</span>
                        </label>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {editTags.map(tag => (
                            <span key={tag} className="badge badge-primary gap-2">
                              {tag}
                              <button
                                className="btn btn-xs btn-circle btn-ghost"
                                onClick={() => removeTag(tag)}
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            className="input input-bordered flex-1"
                            placeholder="Add tag (press Enter)"
                            value={newTagInput}
                            onChange={(e) => setNewTagInput(e.target.value)}
                            onKeyDown={handleTagInputKeyDown}
                            list="tag-suggestions"
                          />
                          <datalist id="tag-suggestions">
                            {allTags.filter(t => !editTags.includes(t)).map(tag => (
                              <option key={tag} value={tag} />
                            ))}
                          </datalist>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => addTag(newTagInput)}
                            disabled={!newTagInput.trim()}
                          >
                            Add
                          </button>
                        </div>
                        {allTags.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs text-base-content/70 mb-1">Existing tags:</p>
                            <div className="flex flex-wrap gap-1">
                              {allTags.filter(t => !editTags.includes(t)).map(tag => (
                                <button
                                  key={tag}
                                  className="badge badge-outline badge-sm cursor-pointer hover:badge-primary"
                                  onClick={() => addTag(tag)}
                                >
                                  + {tag}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <textarea
                        className="textarea textarea-bordered w-full min-h-[200px]"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={handleCancel}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => handleSave(resource.id)}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <h2 className="text-base font-semibold">
                              {resource.title || '(No title)'}
                            </h2>
                            <span className="badge badge-outline badge-sm">
                              {getTypeLabel(resource.metadata)}
                            </span>
                            {(resource.metadata as any)?.category && (
                              <span className="badge badge-secondary badge-sm">
                                {(resource.metadata as any).category}
                              </span>
                            )}
                          </div>
                          {(resource.metadata as any)?.tags && Array.isArray((resource.metadata as any).tags) && (resource.metadata as any).tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {(resource.metadata as any).tags.map((tag: string) => (
                                <span
                                  key={tag}
                                  className="badge badge-primary badge-sm cursor-pointer"
                                  onClick={() => {
                                    if (!tagFilters.includes(tag)) {
                                      addTagFilter(tag);
                                    }
                                  }}
                                  title="Click to filter by this tag"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                          <p className="text-sm text-base-content/70 mb-2">
                            {formatDate(resource.createdAt)}
                          </p>
                          {/* For an image resource the content below is a
                              description of a picture, which is close to
                              useless without the picture. Opens full size in a
                              new tab — the card is too small to judge one. */}
                          {(resource.metadata as any)?.imageUrl && (
                            <a
                              href={(resource.metadata as any).imageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="block mb-3 w-fit"
                            >
                              <Image
                                src={(resource.metadata as any).imageUrl}
                                alt={resource.title || 'Uploaded image'}
                                width={320}
                                height={240}
                                className="max-h-60 w-auto rounded-lg border border-base-300 object-contain"
                                unoptimized
                              />
                            </a>
                          )}
                          {/* Notes are written as markdown — headings, lists,
                              bold — so the preview renders them rather than
                              showing the raw asterisks and hashes. */}
                          <div className="max-w-none break-words text-sm leading-relaxed">
                            {renderSimpleMarkdown(
                              resource.content.length > 500
                                ? `${resource.content.substring(0, 500)}…`
                                : resource.content
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 mt-4">
                        <Link
                          href={`/resources/${resource.id}`}
                          className="btn btn-sm btn-ghost"
                        >
                          Open
                        </Link>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => handleEdit(resource)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-sm btn-error"
                          onClick={() => handleDelete(resource.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {!searchQuery && (
            <div className="flex flex-col items-center justify-center gap-4 mt-6">
              {(() => {
                const totalPages = Math.ceil(totalCount / limit);
                
                // Show pagination buttons only if more than 1 page
                if (totalPages > 1) {
                  return (
                    <div className="join">
                      <button
                        className="join-item btn btn-sm btn-outline"
                        onClick={() => loadResources(currentPage - 1)}
                        disabled={loading || currentPage === 1}
                      >
                        Previous
                      </button>
                      
                      {(() => {
                        const maxVisiblePages = 10;
                        const pages: (number | string)[] = [];
                        
                        if (totalPages <= maxVisiblePages) {
                          // Show all pages
                          return Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                            <button
                              key={page}
                              className={`join-item btn btn-sm ${currentPage === page ? 'btn-active' : ''}`}
                              onClick={() => loadResources(page)}
                              disabled={loading}
                            >
                              {page}
                            </button>
                          ));
                        }
                        
                        // Smart pagination with ellipsis for more than 10 pages
                        // Always show first page
                        pages.push(1);
                        
                        // Show ellipsis if needed
                        if (currentPage > 4) {
                          pages.push('...');
                        }
                        
                        // Show pages around current page (2 on each side)
                        const start = Math.max(2, currentPage - 2);
                        const end = Math.min(totalPages - 1, currentPage + 2);
                        
                        for (let i = start; i <= end; i++) {
                          if (i !== 1 && i !== totalPages) {
                            pages.push(i);
                          }
                        }
                        
                        // Show ellipsis if needed
                        if (currentPage < totalPages - 3) {
                          pages.push('...');
                        }
                        
                        // Always show last page
                        pages.push(totalPages);
                        
                        return pages.map((page, idx) => {
                          if (page === '...') {
                            return (
                              <button
                                key={`ellipsis-${idx}`}
                                className="join-item btn btn-sm btn-disabled"
                                disabled
                              >
                                ...
                              </button>
                            );
                          }
                          return (
                            <button
                              key={page}
                              className={`join-item btn btn-sm ${currentPage === page ? 'btn-active' : ''}`}
                              onClick={() => loadResources(page as number)}
                              disabled={loading}
                            >
                              {page}
                            </button>
                          );
                        });
                      })()}
                      
                      <button
                        className="join-item btn btn-sm btn-outline"
                        onClick={() => loadResources(currentPage + 1)}
                        disabled={loading || !hasMore}
                      >
                        Next
                      </button>
                    </div>
                  );
                }
                return null;
              })()}
              
              <span className="text-sm text-base-content/70">
                Showing {totalCount === 0 ? 0 : ((currentPage - 1) * limit) + 1}-{Math.min(currentPage * limit, totalCount)} of {totalCount}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

